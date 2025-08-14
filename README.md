# HTTP3 Monorepo

A simple monorepo for HTTP/3 packages using npm workspaces.

## Structure

```
http3-server/
├── package.json                # Root package.json with workspace configuration
├── packages/
│   ├── http3-server-native/                # HTTP utilities and implementations
│   │   ├── package.json
│   │   └── index.js
│   └── http3-server-darwin-arm64/      # HTTP/3 implementation for Darwin ARM64
│       ├── package.json
│       └── index.js
└── README.md
```

## Getting Started

1. Install dependencies:
	```bash
	npm install
	```

2. Build all packages:
	```bash
	npm run build
	```

3. Test all packages:
	```bash
	npm run test
	```

4. Clean all packages:
	```bash
	npm run clean
	```

## Packages

### http3-server
General HTTP utilities and implementations.

### @http3-server/darwin-arm64
HTTP/3 implementation specifically for Darwin ARM64 platform.

## Third-Party Libraries

This project uses the following third-party libraries:

- **[msh3](https://github.com/nibanks/msh3)** - Minimal HTTP/3 library (MIT License)
- **[msquic](https://github.com/microsoft/msquic)** - Microsoft's QUIC implementation (MIT License)

See [NOTICE](packages/http3-server/NOTICE) for full license texts.

## License

MIT-0 License - see individual package.json files for details.
