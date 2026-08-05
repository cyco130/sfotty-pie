.export Error = {
	SUCCES: 1             ;($01) succesful operation

	BRKABT: 128           ;($80) BREAK key abort
	PRVOPN: 129           ;($81) IOCB already open error
	NONDEV: 130           ;($82) nonexistent device error
	WRONLY: 131           ;($83) IOCB opened for write only error
	NVALID: 132           ;($84) invalid command error
	NOTOPN: 133           ;($85) device/file not open error
	BADIOC: 134           ;($86) invalid IOCB index error
	RDONLY: 135           ;($87) IOCB opened for read only error
	EOFERR: 136           ;($88) end of file error
	TRNRCD: 137           ;($89) truncated record error
	TIMOUT: 138           ;($8A) peripheral device timeout error
	DNACK : 139           ;($8B) device does not acknowledge command
	FRMERR: 140           ;($8C) serial bus framing error
	CRSROR: 141           ;($8D) cursor overrange error
	OVRRUN: 142           ;($8E) serial bus data overrun error
	CHKERR: 143           ;($8F) serial bus checksum error
	DERROR: 144           ;($90) device done (operation incomplete)
	BADMOD: 145           ;($91) bad screen mode number error
	FNCNOT: 146           ;($92) function not implemented in handler
	SCRMEM: 147           ;($93) insufficient memory for screen mode

	DSKFMT: 148           ;($94) SpartaDOS: unrecognized disk format
	INCVER: 149           ;($95) SpartaDOS: disk was made with incompat. version
	DIRNFD: 150           ;($96) SpartaDOS: directory not found
	FEXIST: 151           ;($97) SpartaDOS: file exists
	NOTBIN: 152           ;($98) SpartaDOS: file not binary
	LSYMND: 154           ;($9A) SDX: loader symbol not defined
	BADPRM: 156           ;($9C) SDX: bad parameter
	OUTOFM: 158           ;($9E) SDX: out of memory
	INVDEV: 160           ;($A0) invalid device number
	TMOF:   161           ;($A1) too many open files
	DSKFLL: 162           ;($A2) disk full
	FATLIO: 163           ;($A3) fatal I/O error
	FNMSMT: 164           ;($A4) internal file number mismatch
	INVFNM: 165           ;($A5) invalid file name
	PDLERR: 166           ;($A6) point data length error
	EPERM:  167           ;($A7) permission denied
	DINVCM: 168           ;($A8) command invalid for disk
	DIRFLL: 169           ;($A9) directory full
	FNTFND: 170           ;($AA) file not found
	PNTINV: 171           ;($AB) point invalid
	BADDSK: 173           ;($AD) bad disk
	INCFMT: 176           ;($B0) DOS 3: incompatible file system
	XNTBIN: 180           ;($B4) XDOS: file not binary
}
