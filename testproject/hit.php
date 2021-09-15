<?php

for ($i=1; $i<6; $i++) {
	echo "Step $i ...\n";
	f1($i);
}

function f1($i) {
	echo "F $i ...\n";
}