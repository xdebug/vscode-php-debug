<?php

// Test stack depth.

function depth1() {
	depth2();
}

function depth2() {
	depth3();
}

function depth3() {
	xdebug_break();
}

depth1();
