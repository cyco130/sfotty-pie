sio = .import "./lib/sio.s"

.code

use_siov:
	jmp sio::SIOV

.export fast_siov:
	lda sio::DDEVIC
	bmi use_siov               ; Use SIOV when high bit is set
	cmp #sio::Device::CASSETTE ; or when device is the cassette.
	bne not_cassette

not_cassette:
	; Find the device in the list of devices
	ldx #0
	cmp devices,x
	beq device_found
	inx
	cpx #8
	bne not_cassette

	; Device not found
	; Make room fo the device
	ldx #7
shift_devices:
	lda devices,x
	sta devices+1,x
	lda speeds,x
	sta speeds+1,x
	dex
	bpl shift_devices

device_found:
	; Get the device speed
	lda speeds,x
	sta speed
	; TODO: Use the speed for the device

.export install_fast_siov:
	lda onedos_siov
	sta use_siov + 1
	lda onedos_siov + 1
	sta use_siov + 2
	lda fast_siov
	sta onedos_jsiov
	lda fast_siov + 1
	sta onedos_jsiov + 1
	rts

.bss
	devices: .res 8
	speeds:  .res 8
