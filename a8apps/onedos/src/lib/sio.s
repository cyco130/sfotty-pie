.export SIOV := $E459 ; Serial I/O entry point

; The Device Control Block
.export DDEVIC := $0300 ; Device number
.export DUNIT  := $0301 ; Unit number
.export DCOMND := $0302 ; Command code
.export DSTATS := $0303 ; I/O direction
.export DBUFLO := $0304 ; Buffer low byte
.export DBUFHI := $0305 ; Buffer high byte
.export DTIMLO := $0306 ; Timeout
.export DUNUSE := $0307 ; Unused
.export DBYTLO := $0308 ; Byte count low byte
.export DBYTHI := $0309 ; Byte count high byte
.export DAUX1  := $030A ; Auxiliary register 1
.export DAUX2  := $030B ; Auxiliary register 2

.export Device = {
	D1: $31
	CASSETTE: $5F
}

.export Command = {
	PUT: $50     ; Write sector without verification
	READ: $52    ; Read sector
	STATUS: $53  ; Get status
	WRITE: $57   ; Write sector with verification
}

.export Direction = {
	COMPUTER_TO_DEVICE: $80
	DEVICE_TO_COMPUTER: $40
}
