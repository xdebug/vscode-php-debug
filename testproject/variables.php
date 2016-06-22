<?php

define('TEST_CONSTANT', 123);

$anArray = array(1, 'test' => 2);
$aFloat = 1.23;
$anInt = 123;
$aString = '123';
$anEmptyString = '';
$aVeryLongString = str_repeat('lol', 1000);
$aBoolean = true;
$nullValue = null;
$variableThatsNotSet;
$aLargeArray = array_fill(0, 100, 'test');
$arrayWithSpaceKey = array('space key' => 1);

exit;
