# Build Artifacts Summary

Generated on: Thu Aug 14 12:44:39 PDT 2025
Workflow Run ID: 16974695457

## Clean Build Structure
```
├── win32-arm64/http3.node
├── linux-arm64/http3.node
├── linux-arm64/libmsh3.so
├── linux-arm64/libmsquic.so
├── darwin-x64/http3.node
├── darwin-x64/libmsquic.2.dylib
├── darwin-x64/libmsh3.dylib
├── win32-x64/http3.node
├── darwin-arm64/http3.node
├── darwin-arm64/libmsquic.2.dylib
├── darwin-arm64/libmsh3.dylib
├── linux-x64/http3.node
├── linux-x64/libmsh3.so
├── linux-x64/libmsquic.so

```

## Platform Coverage
- ✅ darwin-arm64:        1 addon +        2 libraries
- ✅ darwin-x64:        1 addon +        2 libraries
- ✅ linux-arm64:        1 addon +        2 libraries
- ✅ linux-x64:        1 addon +        2 libraries
- ✅ win32-arm64:        1 addon +        0 libraries
- ✅ win32-x64:        1 addon +        0 libraries

## Usage

```bash
# Copy a specific platform to your project
cp -r darwin-arm64 /path/to/your/project/

# Use in your code
const addon = require('./darwin-arm64/http3.node');
```

## Files per platform:
- `http3.node` - The Node.js HTTP/3 addon
- `lib*.dylib/so/dll` - Required MSH3 and MSQuic libraries

All files must be kept together for the addon to work correctly.
