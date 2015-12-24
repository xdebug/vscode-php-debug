LOLOLOL
<?php

    function test2() {
        $text = "hello, user ";
        $userId = 2334;
        return $text + $userId;
    }

    function test() {
        return test2();
    }

    echo test();
    
    function throwException() {
        throw new Exception("this is an exception");
    }
    
    function triggerAnError() {
        trigger_error("this is a warning", E_WARNING);
    }
    
    echo "hi";
    echo "hello";
    echo "hallo";
