.export IOCB :=	$0340, size: 16

.export ICHID := $0340, size: 1
.export ICDNO := $0341, size: 1
.export ICCOM := $0342, size: 1
.export ICSTA := $0343, size: 1
.export ICBAL := $0344, size: 1
.export ICBAH := $0345, size: 1
.export ICPTL := $0346, size: 1
.export ICPTH := $0347, size: 1
.export ICBLL := $0348, size: 1
.export ICBLH := $0349, size: 1
.export ICAX1 := $034A, size: 1
.export ICAX2 := $034B, size: 1
.export ICAX3 := $034C, size: 1
.export ICAX4 := $034D, size: 1
.export ICAX5 := $034E, size: 1
.export ICAX6 := $034F, size: 1

.export CIOV := $E456

.export Command = {
	OPEN: $03
	GETREC: $05
	GETCHR: $07
	PUTREC: $09
	PUTCHR: $0B
	CLOSE: $0C
	STATUS: $0D
}

.export OpenMode = {
	READ: $04
	WRITE: $08
	UPDATE: OpenMode::READ | OpenMode::WRITE
}
