<?php

define('TEST_CONSTANT', 123);

$anArray = array(1, 'test' => 2, 'test2' => ['t' => 123]);
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
$arrayExtended = array("a\0b" => "c\0d");
$arrayExtended2 = array("Приветствие" => "КУ-КУ", "Прощание" => "Па-Ка");

exit;
