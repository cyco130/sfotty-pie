.export PIA_AREA := $D300, size: 256 ; PIA register area

.export PIA := $D300, size: 4 ; Canonical PIA register addresses

.export PORTA := $D300 ; Port A data/direction register
.export PORTB := $D301 ; Port B data/direction register
.export PACTL := $D302 ; Port A control register
.export PBCTL := $D303 ; Port B control register

.export Ctl = {
	IRQ1_ENABLE: 1
	C1_RISING_EDGE_ACTIVE: 2
	DATA_REGISTER_ENABLE: 4

	C2_MASK: $38

	C2_INPUT_RISING_EDGE_ACTIVE: $08
	C2_INPUT_IRQ2_ENABLE: $10

	C2_OUTPUT_READ_HANDSHAKE: $20
	C2_OUTPUT_READ_PULSE: $28
	C2_OUTPUT_LOW: $30
	C2_OUTPUT_HIGH: $38

	IRQ2_PENDING: $40
	IRQ1_PENDING: $80
}


; Joystick bits, zero means pressed. Shift left by 4 to get the bits for the
; second joystick of the port.
.export JoystickBits = {
	UP: 1
	DOWN: 2
	LEFT: 4
	RIGHT: 8
}

.export JoystickDirections = {
	CENTER: $F
	UP: $F ^ JoystickBits::UP
	UP_RIGHT: $F ^ JoystickBits::UP ^ JoystickBits::RIGHT
	RIGHT: $F ^ JoystickBits::RIGHT
	DOWN_RIGHT: $F ^ JoystickBits::DOWN ^ JoystickBits::RIGHT
	DOWN: $F ^ JoystickBits::DOWN
	DOWN_LEFT: $F ^ JoystickBits::DOWN ^ JoystickBits::LEFT
	LEFT: $F ^ JoystickBits::LEFT
	UP_LEFT: $F ^ JoystickBits::UP ^ JoystickBits::LEFT
}

.export PortB = {
	OS_ROM_ENABLE: $01 ; Bit 0
	BASIC_ROM_DISABLE: $02 ; Bit 1
	LED1_OFF: $04 ; Bit 2
	LED2_OFF: $08 ; Bit 3
	CPU_SEES_PRIMARY: $10 ; Bit 4
	ANTIC_SEES_PRIMARY: $20 ; Bit 5
	GAME_ROM_DISABLE: $40 ; Bit 6
	SELF_TEST_ROM_DISABLE: $80 ; Bit 7
}
