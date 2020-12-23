<?php

$array = array('hello' => 'world');

// Notice
trigger_error("Test notice", E_USER_NOTICE);

// Warning
trigger_error("Test warning", E_USER_WARNING);

// Exception
throw new Exception('this is an exception');
