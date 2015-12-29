LOLOLOL
<?php

    $anArray = array(1, 2, "test" => 3, 4);
    $aFloat = 1.23;
    $anInt = 123;
    $aString = "123";
    $anEmptyString = "";
    $aBoolean = true;
    $nullValue = null;
    $variableThatsNotSet;
    $aLargeArray = array_fill(0, 100, 'test');

    class TestClass {
        public $aProperty;
        private $aPrivateProperty;
        public function __construct() {
            $this->aProperty = 123;
            $this->aPrivateProperty = 456;
        }
    }

    $anObject = new TestClass();

    function test2() {
        $text = "hello, user ";
        $userId = 2334;
        return $text + $userId;
    }

    function test($aParameter) {
        return test2();
    }

    echo test("lol");

    class DerivedException extends Exception {}

    function throwException() {
        throw new Exception("this is an exception");
    }

    function throwCaughtException() {
        try {
            throw new Exception('this is a caught exception');
        } catch (Exception $e) {
            echo "catched it";
        }
    }

    function throwDerivedException() {
        throw new DerivedException('this is a derived exception');
    }

    function triggerWarning() {
        $anArray = array();
        $anArray[array()] = 123; // will generate a warning "illegal offset type"
    }

    echo "hi";
    echo "hello";
    echo "hallo";

    triggerWarning();

    throwException();

    throwDerivedException();

    throwCaughtException();


