<?php

$array = array('hello' => 'world');

// Notice (undefined index)
echo $array['undefined_index'];

// Warning (illegal offset type)
$array[array()] = 123;

// Exception
throw new Exception('this is an exception');
