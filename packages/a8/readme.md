# Sfotty Pie A8

**Sfotty Pie A8** is a headless Atari 8-bit emulator, built on the [Sfotty Pie](../sfotty/readme.md) 6502 core. Headless by design: the machine is complete — video, audio, input, and disk I/O all exist — but every interface is a socket for the host to plug into. The framebuffer is a byte array to render, the audio output is a level to sample, and input arrives through methods and signals. See `apps/a8-web` in the repository for a browser host that wires them all.

## License and credits

MIT license.

- [Fatih Aygün](https://github.com/cyco130) and [contributors](https://github.com/cyco130/sfotty-pie/graphs/contributors).

The repository includes the **Altirra Acid800** hardware-conformance test suite (`test/acid800/acid800.atr`) to drive CI conformance tests. It lives in the sources only — the published npm package ships just `dist/` and `atari-src/`, not the test data. Acid800 is by Avery Lee and separately MIT-licensed — see [test/acid800/LICENSE](test/acid800/LICENSE). This project is independent and not affiliated with or endorsed by the Acid800 or Altirra projects.
