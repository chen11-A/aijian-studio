# Pinned Python native redistribution materials

These files support the limited DEVELOPMENT_CORE packaging path. They do not
approve a formal release or replace an assessment of the complete installer.

The companion source is the official Astral 20260807 Windows x64 CPython 3.12.13
`pgo-full` archive. Its release SHA-256 is
`98a0c5295bd53bef39147ffeb0a50d45df12b407e145c1799411cca53dcef90c`.
The binary input remains the pinned `install_only_stripped` archive with SHA-256
`18bcc65b17921806b72cdc88bcf000bf67a2c99a8fc381fe1629f2b9ba56858d`.
Both appear in the [official release's asset list](https://github.com/astral-sh/python-build-standalone/releases/expanded_assets/20260807).

The supplier's [distribution format](https://github.com/astral-sh/python-build-standalone/blob/20260807/docs/distributions.rst)
documents the full archive's `PYTHON.json` and per-extension licence paths. Its
[release conversion code](https://github.com/astral-sh/python-build-standalone/blob/20260807/src/release.rs)
strips debugging data from PE files. Accordingly, 51 of the 54 native interpreter
inputs differ between full and stripped archives; this catalogue never calls
them byte-identical. Actual shipped native files are checked against the original
stripped archive or the separately pinned Windows wheels.

`native-inputs.json` records 72 possible native input files, not a claim that all
ship. `map-dev-native-materials.py` selects only the actual frozen files, rejects
unknown bytes, rehashes their original archives and copies the relevant supplied
licence texts. The generated sidecar executable is bound separately to the exact
backend-source freezer receipt and PyInstaller bootloader input/exception.

The companion licence texts were copied with CRLF normalized to LF; wording and
copyright notices were retained. The HACL MIT notice is the complete leading
licence block from [CPython's exact v3.12.13 source](https://github.com/python/cpython/blob/v3.12.13/Modules/_hacl/Hacl_Hash_SHA2.c).
`LICENSE.python-windows.txt` is the pinned interpreter's existing binary licence,
including its additional Microsoft Distributable Code conditions. Microsoft DLLs
must not be described as PSF-only components. The material sources and hashes
are recorded in the catalogue.

Upstream metadata contains old OpenSSL link names ending `1_1` while this archive
actually ships `libcrypto-3-x64.dll` and `libssl-3-x64.dll`. The supplied licence
path is OpenSSL 3/Apache-2.0 and the actual libcrypto version string is 3.5.7. The
mapper relies on exact binary hashes and actual filenames rather than those
stale link names.

No GPL FFmpeg/FFprobe CLI, development media allowlist extension, installer
upgrade enablement, credential material or formal `RELEASE_APPROVED` state is
introduced by this catalogue. NSIS template component material is a separate
installer-wide check; the Python map must not silently clear it. The limited
development pipeline instead uses the independently verified first-party,
core/zlib-only NSIS route, so those resource plug-ins are not embedded.
