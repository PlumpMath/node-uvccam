var UvcCam = require("../lib/uvccam");


var camera = new UvcCam({
	mode: "photo",
	output: "./photo/image.jpg",
	encoding: "jpg",
	emulateraspicam: "yes",
	timeout: 0 // take the picture immediately
});

camera.on("started", function( err, timestamp ){
	console.log("photo started at " + timestamp );
});

camera.on("read", function( err, timestamp, filename ){
	console.log("photo image captured with filename: " + filename );
});

camera.on("exit", function( timestamp ){
	console.log("photo child process has exited at " + timestamp );
});

camera.start();
