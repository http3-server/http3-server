#!/usr/bin/env python3

import argparse
import asyncio
import ssl
from collections import defaultdict

from aioquic.asyncio.client import connect
from aioquic.asyncio.protocol import QuicConnectionProtocol
from aioquic.h3.connection import H3_ALPN, H3Connection, HeadersState
from aioquic.h3.events import DataReceived, DatagramReceived, HeadersReceived
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.events import ConnectionTerminated


class SmokeClient(QuicConnectionProtocol):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.http = H3Connection(self._quic, enable_webtransport=True)
        self.events = defaultdict(list)
        self.waiters = {}
        self.header_waiters = set()
        self.datagram_waiter = None
        self.connection_terminated = self._loop.create_future()

    def quic_event_received(self, event):
        if isinstance(event, ConnectionTerminated):
            if not self.connection_terminated.done():
                self.connection_terminated.set_result(None)
            for waiter in self.waiters.values():
                if not waiter.done():
                    waiter.set_exception(
                        ConnectionError(
                            f"QUIC connection terminated: error={event.error_code} "
                            f"frame={event.frame_type} reason={event.reason_phrase!r}"
                        )
                    )
            self.waiters.clear()
            return
        for http_event in self.http.handle_event(event):
            if isinstance(http_event, DatagramReceived):
                if self.datagram_waiter is not None and not self.datagram_waiter.done():
                    self.datagram_waiter.set_result(http_event.data)
                continue
            if not isinstance(http_event, (HeadersReceived, DataReceived)):
                continue
            stream_id = http_event.stream_id
            self.events[stream_id].append(http_event)
            # aioquic 1.3.0 treats every first response HEADERS block as the
            # final response, including informational responses. Restore the
            # initial state after 1xx so the pinned test client can validate
            # the subsequent final HEADERS block as a response, not trailers.
            if isinstance(http_event, HeadersReceived):
                response_status = int(dict(http_event.headers).get(b":status", b"0"))
                if 100 <= response_status < 200:
                    self.http._stream[stream_id].headers_recv_state = HeadersState.INITIAL
            if stream_id in self.header_waiters and isinstance(http_event, HeadersReceived):
                self._complete(stream_id)
            elif http_event.stream_ended:
                self._complete(stream_id)

    async def get(self, authority, path):
        return await self.get_with_headers(authority, path, [])

    async def request(self, authority, method, path, data=b""):
        stream_id = self._quic.get_next_available_stream_id()
        waiter = self._loop.create_future()
        self.waiters[stream_id] = waiter
        self.http.send_headers(
            stream_id,
            [
                (b":method", method.encode()),
                (b":scheme", b"https"),
                (b":authority", authority.encode()),
                (b":path", path.encode()),
            ],
            end_stream=not data,
        )
        if data:
            self.http.send_data(stream_id, data, end_stream=True)
        self.transmit()
        return await asyncio.wait_for(waiter, timeout=5)

    async def get_with_headers(self, authority, path, headers):
        stream_id = self._quic.get_next_available_stream_id()
        waiter = self._loop.create_future()
        self.waiters[stream_id] = waiter
        self.http.send_headers(
            stream_id,
            [
                (b":method", b"GET"),
                (b":scheme", b"https"),
                (b":authority", authority.encode()),
                (b":path", path.encode()),
                *headers,
            ],
            end_stream=True,
        )
        self.transmit()
        return await asyncio.wait_for(waiter, timeout=5)

    async def request_with_raw_headers(self, headers, end_stream=True):
        stream_id = self._quic.get_next_available_stream_id()
        waiter = self._loop.create_future()
        self.waiters[stream_id] = waiter
        self.http.send_headers(stream_id, headers, end_stream=end_stream)
        self.transmit()
        return await asyncio.wait_for(waiter, timeout=5)

    async def webtransport_connect(self, authority, path):
        _, response = await self.open_webtransport(authority, path)
        return response

    async def open_webtransport(self, authority, path):
        stream_id = self._quic.get_next_available_stream_id()
        waiter = self._loop.create_future()
        self.waiters[stream_id] = waiter
        self.header_waiters.add(stream_id)
        self.http.send_headers(
            stream_id,
            [
                (b":method", b"CONNECT"),
                (b":scheme", b"https"),
                (b":authority", authority.encode()),
                (b":path", path.encode()),
                (b":protocol", b"webtransport"),
                (b"sec-webtransport-http3-draft02", b"1"),
            ],
        )
        self.transmit()
        response = await asyncio.wait_for(waiter, timeout=5)
        return stream_id, response

    async def slow_upload(self, authority, path):
        stream_id = self._quic.get_next_available_stream_id()
        waiter = self._loop.create_future()
        self.waiters[stream_id] = waiter
        self.http.send_headers(
            stream_id,
            [
                (b":method", b"POST"),
                (b":scheme", b"https"),
                (b":authority", authority.encode()),
                (b":path", path.encode()),
            ],
        )
        self.http.send_data(stream_id, b"a" * (64 * 1024), end_stream=False)
        self.transmit()
        await asyncio.sleep(0.35)
        self.http.send_data(stream_id, b"b" * (64 * 1024), end_stream=True)
        self.transmit()
        return await asyncio.wait_for(waiter, timeout=5)

    async def wait_for_datagram(self):
        self.datagram_waiter = self._loop.create_future()
        return await asyncio.wait_for(self.datagram_waiter, timeout=5)

    async def wait_for_termination(self):
        return await asyncio.wait_for(self.connection_terminated, timeout=5)

    def _complete(self, stream_id):
        waiter = self.waiters.pop(stream_id, None)
        self.header_waiters.discard(stream_id)
        if waiter is not None and not waiter.done():
            waiter.set_result(self.events.pop(stream_id))


def status(events):
    for event in events:
        if isinstance(event, HeadersReceived):
            return int(dict(event.headers)[b":status"])
    raise AssertionError("response contained no status headers")


def body(events):
    return b"".join(event.data for event in events if isinstance(event, DataReceived))


def has_header(events, name, value):
    return any(
        (name, value) in event.headers
        for event in events
        if isinstance(event, HeadersReceived)
    )


def configuration():
    return QuicConfiguration(
        is_client=True,
        alpn_protocols=H3_ALPN,
        max_datagram_frame_size=65_536,
        verify_mode=ssl.CERT_NONE,
    )


async def run_smoke(host, port, request_count):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        responses = await asyncio.gather(
            *(client.get(authority, f"/baseline/{index}") for index in range(request_count))
        )
        for response in responses:
            assert status(response) == 200
            assert body(response) == b"baseline"

        response = await client.webtransport_connect(authority, "/transport")
        assert status(response) == 200
        client.close()


async def run_drain(host, port):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        hold = asyncio.create_task(client.get(authority, "/hold"))
        await asyncio.sleep(0.2)
        rejected = await client.get(authority, "/during-drain")
        assert status(rejected) == 503
        completed = await hold
        assert status(completed) == 200
        assert body(completed) == b"drained"
        client.close()


async def run_expect_abort(host, port):
    authority = f"{host}:{port}"
    try:
        async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
            response = await client.get(authority, "/hold")
    except (ConnectionError, asyncio.TimeoutError):
        return
    # QUIC stacks may surface a peer abort either as connection termination or
    # as a completed stream containing no HTTP response headers.
    try:
        status(response)
    except AssertionError:
        return
    raise AssertionError("request completed instead of being aborted at the drain deadline")


async def run_reliable_success(host, port):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        response, empty = await asyncio.gather(
            client.get(authority, "/body"),
            client.get(authority, "/empty"),
        )
        assert status(response) == 200
        assert body(response) == b"payload"
        assert has_header(response, b"x-finished", b"yes")
        assert status(empty) == 204
        assert body(empty) == b""
        # Keep the connection open long enough for the server to observe the
        # acknowledged FIN rather than a connection-close cancellation race.
        await asyncio.sleep(0.2)
        client.close()


async def run_method_matrix(host, port):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        get, head, post, put = await asyncio.gather(
            client.request(authority, "GET", "/methods/get"),
            client.request(authority, "HEAD", "/methods/head"),
            client.request(authority, "POST", "/methods/post", b"alpha"),
            client.request(authority, "PUT", "/methods/put", b"beta"),
        )
        assert status(get) == 200 and body(get) == b"GET:"
        assert status(head) == 204 and body(head) == b""
        assert status(post) == 200 and body(post) == b"POST:alpha"
        assert status(put) == 200 and body(put) == b"PUT:beta"
        client.close()


async def run_early_hints(host, port):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        response = await client.get(authority, "/early-hints")
        statuses = [
            int(dict(event.headers)[b":status"])
            for event in response
            if isinstance(event, HeadersReceived)
        ]
        assert statuses == [103, 200]
        assert body(response) == b"final"
        client.close()


async def run_streaming_response(host, port, require_cookies=False):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        response = await client.get(authority, "/streaming-response")
        response_body = body(response)
        assert status(response) == 200
        assert len(response_body) == 64 * 64 * 1024
        assert response_body == b"x" * len(response_body)
        if require_cookies:
            assert sum(
                1
                for event in response
                if isinstance(event, HeadersReceived)
                for header in event.headers
                if header[0] == b"set-cookie"
            ) == 2
        # Let the server observe acknowledgment of the stream FIN before the
        # connection closes, so the completion result is deterministic.
        await asyncio.sleep(0.2)
        client.close()


async def run_handler_failure(host, port):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        response = await client.get(authority, "/handler-failure")
        assert status(response) == 500
        assert body(response) == b""
        client.close()


async def run_webtransport_rejection(host, port, expected_status):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        response = await client.webtransport_connect(authority, "/rejected")
        assert status(response) == expected_status
        client.close()


async def run_header_limits(host, port):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        repeated, oversized, long_url, *flooded = await asyncio.gather(
            client.get_with_headers(authority, "/repeated", [(b"x-repeat", b"a"), (b"x-repeat", b"b")]),
            client.get_with_headers(authority, "/oversized", [(b"x-large", b"x" * 300)]),
            client.get(authority, "/" + "x" * 100),
            *(
                client.get_with_headers(
                    authority,
                    f"/flooded/{index}",
                    [(b"x-one", b"1"), (b"x-two", b"2"), (b"x-three", b"3")],
                )
                for index in range(32)
            ),
        )
        assert status(repeated) == 204
        assert status(oversized) == 431
        assert status(long_url) == 431
        assert all(status(response) == 431 for response in flooded)
        client.close()


async def run_adversarial_headers(host, port):
    authority = f"{host}:{port}".encode()
    invalid_requests = (
        [
            (b"x-before-pseudo", b"1"),
            (b":method", b"GET"),
            (b":scheme", b"https"),
            (b":authority", authority),
            (b":path", b"/reordered"),
        ],
        [
            (b":method", b"GET"),
            (b":method", b"POST"),
            (b":scheme", b"https"),
            (b":authority", authority),
            (b":path", b"/duplicate"),
        ],
        [
            (b":method", b"GET"),
            (b":scheme", b"https"),
            (b":authority", authority),
            (b":path", b"/unknown"),
            (b":unknown", b"value"),
        ],
        [
            (b":method", b"GET"),
            (b":scheme", b"http"),
            (b":authority", authority),
            (b":path", b"/wrong-scheme"),
        ],
        [
            (b":method", b"GET"),
            (b":scheme", b"https"),
            (b":authority", authority),
        ],
    )
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        for headers in invalid_requests:
            response = await client.request_with_raw_headers(headers)
            assert status(response) == 400
        client.close()


async def run_connection_churn(host, port):
    authority = f"{host}:{port}"
    for index in range(24):
        async with connect(
            host, port, configuration=configuration(), create_protocol=SmokeClient
        ) as client:
            response = await client.get(authority, f"/churn/{index}")
            assert status(response) == 204
            client.close()

    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        stream_id = client._quic.get_next_available_stream_id()
        client.http.send_headers(
            stream_id,
            [
                (b":method", b"POST"),
                (b":scheme", b"https"),
                (b":authority", authority.encode()),
                (b":path", b"/abrupt"),
            ],
        )
        client.http.send_data(stream_id, b"partial", end_stream=False)
        client.transmit()
        await asyncio.sleep(0.05)
        client.close(error_code=0x100, reason_phrase="adversarial disconnect")


async def run_slow_upload(host, port):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        response = await client.slow_upload(authority, "/slow-upload")
        assert status(response) == 200
        assert body(response) == b"131072"
        client.close()


async def run_upload_expect_abort(host, port):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        stream_id = client._quic.get_next_available_stream_id()
        client.http.send_headers(
            stream_id,
            [
                (b":method", b"POST"),
                (b":scheme", b"https"),
                (b":authority", authority.encode()),
                (b":path", b"/pending-upload"),
            ],
        )
        client.http.send_data(stream_id, b"pending" * 8192, end_stream=False)
        client.transmit()
        await client.wait_for_termination()


async def run_slow_webtransport_stream(host, port):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        session_id, response = await client.open_webtransport(authority, "/slow-stream")
        assert status(response) == 200
        assert client._quic._remote_max_stream_data_bidi_remote >= 1024 * 1024
        assert client._quic._remote_max_data >= 16 * 1024 * 1024
        stream_id = client.http.create_webtransport_stream(session_id)
        assert client._quic._streams[stream_id].max_stream_data_remote >= 1024 * 1024
        client._quic.send_stream_data(stream_id, b"a" * (64 * 1024), end_stream=False)
        client.transmit()
        await asyncio.sleep(0.35)
        client._quic.send_stream_data(stream_id, b"b" * (64 * 1024), end_stream=True)
        client.transmit()
        for _ in range(50):
            progress = await client.get(authority, "/webtransport-progress")
            assert status(progress) == 200
            if body(progress) == b"131072":
                break
            await asyncio.sleep(0.1)
        else:
            raise AssertionError("server did not consume all WebTransport stream bytes")
        client.close()


async def run_opaque_ids(host, port):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        responses = await asyncio.gather(
            client.get(authority, "/opaque/one"),
            client.get(authority, "/opaque/two"),
        )
        for response in responses:
            assert status(response) == 204
            assert body(response) == b""
        await asyncio.sleep(0.2)
        client.close()


async def run_stream_limit(host, port):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        accepted = asyncio.create_task(client.get(authority, "/hold"))
        await asyncio.sleep(0.2)
        rejected = await client.get(authority, "/excess")
        assert status(rejected) == 503
        completed = await accepted
        assert status(completed) == 204
        client.close()


async def run_connection_limit(host, port):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as first:
        response = await first.get(authority, "/first")
        assert status(response) == 204
        try:
            async with connect(
                host, port, configuration=configuration(), create_protocol=SmokeClient
            ) as second:
                await second.get(authority, "/excess-connection")
        except (ConnectionError, asyncio.TimeoutError):
            pass
        else:
            raise AssertionError("connection completed despite the configured connection limit")
        first.close()


async def run_server_datagram(host, port):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        datagram = asyncio.create_task(client.wait_for_datagram())
        response = await client.webtransport_connect(authority, "/datagrams")
        assert status(response) == 200
        assert await datagram == b"server-datagram"
        client.close()


async def run_webtransport_expect_abort(host, port):
    authority = f"{host}:{port}"
    async with connect(host, port, configuration=configuration(), create_protocol=SmokeClient) as client:
        session_id, response = await client.open_webtransport(authority, "/hold-transport")
        assert status(response) == 200
        stream_id = client.http.create_webtransport_stream(session_id)
        client._quic.send_stream_data(stream_id, b"pending" * 8192, end_stream=False)
        client.transmit()
        await client.wait_for_termination()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("host")
    parser.add_argument("port", type=int)
    parser.add_argument(
        "--mode",
        choices=(
            "smoke",
            "drain",
            "expect-abort",
            "reliable-success",
            "method-matrix",
            "early-hints",
            "streaming-response",
            "public-streaming-response",
            "handler-failure",
            "webtransport-501",
            "webtransport-403",
            "header-limits",
            "adversarial-headers",
            "connection-churn",
            "slow-upload",
            "upload-expect-abort",
            "slow-webtransport-stream",
            "opaque-ids",
            "stream-limit",
            "connection-limit",
            "server-datagram",
            "webtransport-expect-abort",
        ),
        default="smoke",
    )
    parser.add_argument("--requests", type=int, default=32)
    arguments = parser.parse_args()
    if arguments.mode == "drain":
        asyncio.run(run_drain(arguments.host, arguments.port))
    elif arguments.mode == "expect-abort":
        asyncio.run(run_expect_abort(arguments.host, arguments.port))
    elif arguments.mode == "reliable-success":
        asyncio.run(run_reliable_success(arguments.host, arguments.port))
    elif arguments.mode == "method-matrix":
        asyncio.run(run_method_matrix(arguments.host, arguments.port))
    elif arguments.mode == "early-hints":
        asyncio.run(run_early_hints(arguments.host, arguments.port))
    elif arguments.mode == "streaming-response":
        asyncio.run(run_streaming_response(arguments.host, arguments.port))
    elif arguments.mode == "public-streaming-response":
        asyncio.run(run_streaming_response(arguments.host, arguments.port, require_cookies=True))
    elif arguments.mode == "handler-failure":
        asyncio.run(run_handler_failure(arguments.host, arguments.port))
    elif arguments.mode == "webtransport-501":
        asyncio.run(run_webtransport_rejection(arguments.host, arguments.port, 501))
    elif arguments.mode == "webtransport-403":
        asyncio.run(run_webtransport_rejection(arguments.host, arguments.port, 403))
    elif arguments.mode == "header-limits":
        asyncio.run(run_header_limits(arguments.host, arguments.port))
    elif arguments.mode == "adversarial-headers":
        asyncio.run(run_adversarial_headers(arguments.host, arguments.port))
    elif arguments.mode == "connection-churn":
        asyncio.run(run_connection_churn(arguments.host, arguments.port))
    elif arguments.mode == "slow-upload":
        asyncio.run(run_slow_upload(arguments.host, arguments.port))
    elif arguments.mode == "upload-expect-abort":
        asyncio.run(run_upload_expect_abort(arguments.host, arguments.port))
    elif arguments.mode == "slow-webtransport-stream":
        asyncio.run(run_slow_webtransport_stream(arguments.host, arguments.port))
    elif arguments.mode == "opaque-ids":
        asyncio.run(run_opaque_ids(arguments.host, arguments.port))
    elif arguments.mode == "stream-limit":
        asyncio.run(run_stream_limit(arguments.host, arguments.port))
    elif arguments.mode == "connection-limit":
        asyncio.run(run_connection_limit(arguments.host, arguments.port))
    elif arguments.mode == "server-datagram":
        asyncio.run(run_server_datagram(arguments.host, arguments.port))
    elif arguments.mode == "webtransport-expect-abort":
        asyncio.run(run_webtransport_expect_abort(arguments.host, arguments.port))
    else:
        asyncio.run(run_smoke(arguments.host, arguments.port, arguments.requests))


if __name__ == "__main__":
    main()
