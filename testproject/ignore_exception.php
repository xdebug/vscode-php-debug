<?php

namespace App;

class IgnoreException extends \Exception
{}

class NotIgnoreException extends \Exception
{}

try {
    // see launch.json ignoreExceptions
    throw new IgnoreException('This exception is ignored');
} catch (\Exception $e) {
    //
}

try {
    throw new NotIgnoreException('This exception is not ignored');
} catch (\Exception $e) {
    //
}
