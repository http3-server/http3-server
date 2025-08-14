import { HTTP3NativeServer } from "./http3-native-server.js"

console.log({ HTTP3Native: HTTP3NativeServer });

const server = new HTTP3NativeServer();

console.log({ server });
