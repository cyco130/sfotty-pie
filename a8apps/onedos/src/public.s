;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; Zeropage temporaries

.export ptr1 := $018, size: 2 ; (DSKFMS DOS File Management System pointer)
.export ptr2 := $01A, size: 2 ; (DSKUTL DOS utility pointer)

; FMSZPG, 7 bytes
.export ptr3 := $43, size: 2
.export ptr4 := $45, size: 2
.export tmp1 := $47, size: 1
.export tmp2 := $48, size: 1

.export sp_save = $49

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; Page 2 locations

.export RUNAD  := $02E0, size: 2 ; Executable run address
.export INITAD := $02E2, size: 2 ; Executable init address

; Page 7 locations
.export MDOSCODE := $0700 ; (Possibly masqueraded) DOS code
.export MDOSVER  := $0701 ; (Possibly masqueraded) DOS version
.export DOSCODE  := $0702 ; Real DOS code
.export DOSVER   := $0703 ; Real DOS version

.export WRTCMD   := $0704 ; Write command to turn verify on/off
.export JSIO     := $070C ; Jump to serial I/O entry point

.export DOSLOAD  := $0710
