# Sfotty Pie

**Sfotty Pie** is a set of tools related to the 6502 (**S**ixty **F**ive **O**h **T**wo) CPU. [MOS Technology 6502](https://en.wikipedia.org/wiki/MOS_Technology_6502) is an 8-bit microprocessor introduced in 1975 that powered many classic consoles and home computers such as Atari 2600, Atari 8-bit family, Apple II, Nintendo Entertainment System, Commodore 64, Atari Lynx, and BBC Micro.

## Packages

Currently, Sfotty Pie consists of the following packages:

| Package                                           | Description                                   |
| ------------------------------------------------- | --------------------------------------------- |
| [`@sfotty-pie/sfotty`](packages/sfotty/readme.md) | Cycle-exact 6502 emulator                     |
| [`@sfotty-pie/cli`](packages/cli/readme.md)       | Emulator for a hypothetical 6502-based system |
| [`@sfotty-pie/a8`](packages/a8/readme.md)         | A headless Atari 8-bit emulator               |
| [`@sfotty-pie/spasm`](packages/spasm/readme.md)   | A WIP 6502 cross-assembler/linker             |

## Apps

| App                                        | Description                                                    |
| ------------------------------------------ | -------------------------------------------------------------- |
| [Sfotty Pie A8 Web](apps/a8-web/readme.md) | A browser-based Atari 8-bit emulator built on `@sfotty-pie/a8` |

## License and credits

Sfotty Pie is MIT-licensed.

- [Fatih Aygün](https://github.com/cyco130) and [contributors](https://github.com/cyco130/sfotty-pie/graphs/contributors).

### Third-party firmware

The web app [a8-web](apps/a8-web) bundles open replacement OS and BASIC ROMs. These keep their own licenses and don't affect Sfotty Pie's MIT license (they're data the emulator loads, not part of its code):

- **AltirraOS** and **Altirra BASIC** by Avery Lee — FSF all-permissive license, from the [Altirra emulator](https://www.virtualdub.org/altirra.html).
- **Atari++ OS (os++)** and **Atari++ BASIC (Basic++)** by Thomas Richter / THOR Software — [Thor Public License](apps/a8-web/public/legal/atari++/THOR-Public-License.txt) (a Mozilla Public License 1.1 variant); the corresponding source is bundled alongside it.

Full notices and bundled source: [THIRD-PARTY-LICENSES](apps/a8-web/public/legal/THIRD-PARTY-LICENSES.md).

### Third-party test suites

The [`@sfotty-pie/a8`](packages/a8/readme.md) repository sources include the **Altirra Acid800** hardware-conformance test suite by Avery Lee (separately MIT-licensed) to drive CI conformance tests — see [packages/a8/test/acid800/LICENSE](packages/a8/test/acid800/LICENSE). It is not shipped in the published npm package.

### Not affiliated

Sfotty Pie is an independent project. It is not affiliated with or endorsed by Atari, the Altirra/Acid800 project (Avery Lee), or the Atari++ project (Thomas Richter); the third-party works above are used under their own licenses.
