<?php

class IgnoreException extends Exception
{}

try {
    // see launch.json ignoredExceptions
    throw new IgnoreException('this is an ignored exception');
} catch (Exception $e) {
    //
}
