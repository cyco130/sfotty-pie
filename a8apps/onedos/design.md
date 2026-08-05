# OneDOS Design Document

- Returning from `INITAD` with carry set and `INITAD` set to 0 aborts the loading process.

## Drivers vs. programs

DOS cold start:

- Set up parameters
- Set `DOSINI`
- Set `DOSVEC`

DOS warm start:

- Set `MEMLO`
- Install `D:` handler
- If first time, load device drivers

Driver `INITAD`:

- Indicate error if performing warm start
- Check if the driver is loadable (e.g. the system has the expected hardware)

Driver `RUNAD`:

- Self-relocate to `MEMLO`
- Save original `DOSINI` and update it
- Jump to the code right after the `JSR` to old `DOSINI`

Driver warm start:

- `JSR` to old `DOSINI` (skipped on the first run)
- Set `MEMLO`
- Install driver's handlers (CIO devices, etc.)

## CIO

### Functions

| Function | CIO Command | Example                            |
| -------: | ----------- | ---------------------------------- |
|       32 | RENAME      | `XIO 32, #1, 0, 0, "D: OLD, NEW"`  |
|       33 | DELETE      | `XIO 33, #1, 0, 0, "D: TEMP.BAS"`  |
|       35 | LOCK FILE   | `XIO 35, #1, 0, 0, "D: ATARI.BAS"` |
|       36 | UNLOCK FILE | `XIO 36, #1, 0, 0, "D: DOSEX.BAS"` |

### Directory entry

|   Byte | Description     |
| -----: | --------------- |
|      0 | Flags           |
|   1..2 | Size in sectors |
|   3..4 | Starting sector |
|  5..12 | Name            |
| 13..15 | Extension       |

|     Bit | Name      | Description                                                          |
| ------: | --------- | -------------------------------------------------------------------- |
| 0 ($01) | OUTPUT    | Opened for output / DOS 2.5 extended file (if "in use" bit is clear) |
| 1 ($02) | DOS_2     | Created by DOS 2.                                                    |
| 2 ($04) | NO_LINK   | File doesn't use file no in sector links (MyDOS)                     |
| 3 ($08) | UNUSED    | _Not used_                                                           |
| 4 ($10) | DIRECTORY | Subdirectory (MyDOS)                                                 |
| 5 ($20) | LOCKED    | Locked                                                               |
| 6 ($40) | IN_USE    | In use                                                               |
| 7 ($80) | DELETED   | Deleted                                                              |

| Byte | Size | Description              |
| ---: | ---: | ------------------------ |
|    0 |    1 | Flags                    |
|    1 |    2 | First sector map         |
|    3 |    3 | Length                   |
|    6 |    8 | File name                |
|   14 |    3 | Extension                |
|   17 |    3 | Last modified date (DMY) |
|   20 |    3 | Last modified time (HMS) |

- 0: Protected
- 1: Hidden (SDFS 2.1 only)
- 2: Archived (SDFS 2.1 only)
- 3: In use (exclusive with bit 4)
- 4: Deleted (exclusive with bit 3)
- 5: Subdirectory (exclusive with bit 6)
- 6: Symbolic link (exclusive with bit 5)
- 7: Open for write

| Name           | Atari | Sparta |
| -------------- | ----- | ------ |
| Locked         | 5     | 0      |
| Deleted        | 7     | 4      |
| Directory      | 4     | 5      |
| Open for write | 0     | 7      |

- DOS 1.0
- DOS 2.0
- DOS 2.5
- MyDOS
- SpartaDOS

| 0 ($01) | OUTPUT | Opened for output / DOS 2.5 extended file (if "in use" bit is clear) |
| 1 ($02) | DOS*2 | Created by DOS 2. |
| 2 ($04) | NO_LINK | File doesn't use file no in sector links (MyDOS) |
| 3 ($08) | UNUSED | \_Not used* |
| 4 ($10) | DIRECTORY | Subdirectory (MyDOS) |
| 5 ($20) | LOCKED | Locked |
| 6 ($40) | IN_USE | In use |
| 7 ($80) | DELETED | Deleted |

### Device number

- 400/800 OSes accept 0..9.
- XL/XE OSes accept 1..9.
- We accept 0..9, A..O, and a..o (0..15) with no number defaulting to 0.

## Sector buffers

- Each slot is 128-byte long
- DD disks use two consecutive slots
- HD disks use four consecutive slots
- When searching for a non-SD buffer, compacting rearranges the slots without breaking multi-slot buffers.

- Bits 0..3: Drive no (0 means slot is free)
- Bits 4..5: Number of slots following this one (0..3)
- Bit 6: In use
- Bit 7: Dirty

Searching for a buffer slot:

- Free slots
- Unused slots
- Non-dirty, non-system slots
- Non-dirty, system slots
- Dirty, non-system slots
- Dirty, system slots

## Current directory state

## Per-drive state

- File system
  - $00: Unknown
  - $40: AtariDOS
  - $80: SpartaDOS
- Density (sectors per track)
- Number of open files

## ADFS (Atari DOS File System) state

Open for read:

- Drive number (ICDNO)
- Open mode (ICAX1)
- Sector number (ICAX3/ICAX4)
- Sector offset (ICAX5)

Open for read directory:

- Drive number (ICDNO)
- Open mode (ICAX1)
- Sector number (ICAX3/ICAX4)
- Sector offset (ICAX5)
- Phase (last line or normal line)
- Line buffer offset
- File spec (11 bytes)

Open for write:

- Drive number (ICDNO)
- Open mode (ICAX1)
- Sector number (ICAX3/ICAX4)
- Sector offset (ICAX5)
- Directory entry (so we can update the file size and open for output flag when closing the file)
  - Two-byte sector number
  - One-byte offset
- First sector
- Number of sectors written (so we can update the file size when closing the file)

---

- Find file
- Find file in directory
- Parse file spec
- Parse drive number
