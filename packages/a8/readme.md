# Sfotty Pie A8

**Sfotty Pie A8** is a headless Atari 8-bit emulator, built on the [Sfotty Pie](../sfotty/readme.md) 6502 core. Headless by design: the machine is complete — video, audio, input, and disk I/O all exist — but every interface is a socket for the host to plug into. The framebuffer is a byte array to render, the audio output is a level to sample, and input arrives through methods and signals. See `apps/a8-web` in the repository for a browser host that wires them all.

## License and credits

MIT license.

- [Fatih Aygün](https://github.com/cyco130) and [contributors](https://github.com/cyco130/sfotty-pie/graphs/contributors).
