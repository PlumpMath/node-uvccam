var events = require('events'),
    exec = require("child_process").exec,
    util = require("util"),
    fs = require("fs"),
    _ = require("lodash"),
    __ = require("../lib/fn.js"),
    raspicam_parameters = require("../options").raspicam_parameters,
    flags = require("../options").flags;


// maximum timeout allowed by uvccam command
var INFINITY_MS = 9999;

// flat to tell if a process is running
var PROCESS_RUNNING_FLAG = false;

// commands
var PHOTO_CMD = '/usr/bin/uvccapture';
var TIMELAPSE_CMD = '/usr/bin/uvccapture';
//var VIDEO_CMD = '/opt/vc/bin/raspivid';

// the process id of the process execed to take photos/video
var child_process = null;


// Exit strategy to kill child process
// (eg. for timelapse) on parent process exit
process.on('exit', function() {
  if(PROCESS_RUNNING_FLAG){
    child_process.kill();
  }
});


/**
 * UvcCam
 * @constructor
 *
 * @description UVC camera controller object
 *
 * @param {Object} opts Options: mode, freq, delay, width, height, quality, encoding, filepath, filename, timeout
 */
function UvcCam( opts ) {
  
  if ( !(this instanceof UvcCam) ) {
    return new UvcCam( opts );
  }

  // Ensure opts is an object
  opts = opts || {};

  if(typeof opts.mode === "undefined" || typeof opts.output === "undefined"){
    console.log("Error: UvcCam: must define mode and output");
    return false;
  }

  // Initialize this Board instance with
  // param specified properties.
  this.opts = {};
  _.assign( this.opts, opts );


  // Set up opts defaults
  this.defaultOpts( );

  // If we want to use raspicam (for easy compatibility) convert opts
  if(_.has(this.opts, "emulateraspicam")) {
	this.raspicamOpts( );
  }

  // Create derivative opts
  this.derivativeOpts( );

  // If this.filepath doesn't exist, make it
  this.createFilepath( );
  
  //child process
  this.child_process = null;

  //directory watcher
  this.watcher = null;

  //events.EventEmitter.call(this);
}

// Inherit event api
util.inherits( UvcCam, events.EventEmitter );

/**
*
* raspicamOpts()
*
* converts options to raspicam equivalent
* 
**/
UvcCam.prototype.raspicamOpts = function(){

  opts = this.opts;
  delete this.opts["emulateraspicam"];

//opts = _.omit(opts, "emulateraspicam");
  for(var opt in opts){

      // if this opt is in the raspicam_parameters hash

      if(typeof raspicam_parameters[opt] !== "undefined"){
        // reassign it to the full word only if there is a corresponding parameter value
	// since certain parameters aren't taken by uvccamera
        if(raspicam_parameters[opt] != "") this.opts[raspicam_parameters[opt]] = opts[opt];
        delete this.opts[opt];
      }

      // if this opt is in the flags hash
      if(typeof flags[opt] !== "undefined"){

        // reassign it to the full word
        this.opts[flags[opt]] = opts[opt];
        delete this.opts[opt];
      }
  }



};


/**
*
* defaultOpts()
*
* Parses the opts to set defaults.
*
**/
UvcCam.prototype.defaultOpts = function(){

  this.opts.mode = this.opts.mode || 'photo';//photo, timelapse or video

  this.opts.width = this.opts.width || 640;
  this.opts.height = this.opts.height || 480;

  // Limit timeout to the maximum value
  // supported by the camera,
  // determined by testing.
  if(typeof this.opts.timeout !== "undefined"){
    this.opts.timeout = Math.min( this.opts.timeout, INFINITY_MS );
  }

};


/**
*
* derivativeOpts()
*
* Create any derivative opts, such as filepath and filename
* 
**/
UvcCam.prototype.derivativeOpts = function(){

  this.filename = this.opts.o.substr( this.opts.o.lastIndexOf("/") + 1 );

  this.filepath = this.opts.o.substr(0, this.opts.o.lastIndexOf("/") + 1 ) || "./";
};


/**
*
* createFilepath()
*
* Create the filepath if it doesn't already exist.
* 
**/
UvcCam.prototype.createFilepath = function(){
  if( !fs.existsSync( this.filepath )){
    fs.mkdirSync( this.filepath );

    // set write permissions
    fs.chmodSync( this.filepath, 0755 );
  }
};



UvcCam.prototype.watchDirectory = function( ) {
  //alias to pass to callbacks
  var self = this;

  //close previous directory watcher if any
  if(this.watcher !== null){
    this.watcher.close();
  }

  //start watching the directory where the images will be stored to emit signals on each new photo saved
  this.watcher = fs.watch(this.filepath, function(event, filename){
    //rename is called once, change is called 3 times, so check for rename to elimate duplicates
    if(event === "rename"){
      self.emit( "read", null, new Date().getTime(), filename );
    }else{
      console.log('uvccam::watcher::event ' + event);
      self.emit( event, null, new Date().getTime(), filename );
    }
  });
};

/**
 * start Take a snapshot or start a timelapse or video recording
 * @param  {Number} mode Sensor pin mode value
 * @return {Object} instance
 */
UvcCam.prototype.start = function( ) {

  if(PROCESS_RUNNING_FLAG){
    return false;
  }

  this.watchDirectory();

  // build the arguments
  var argstring = "";

  for(var opt in this.opts){
    if(opt !== "mode"){
      //don't add value for true flags
      if( this.opts[opt].toString() != "true" && this.opts[opt].toString() != "false"){
        argstring += "-" + opt + this.opts[opt].toString() + " ";
      }
    }
  }


  var cmd;

  switch(this.opts.mode){
    case 'photo':
      cmd = PHOTO_CMD;
      break;
    case 'timelapse':
      cmd = TIMELAPSE_CMD;

      // if no timelapse frequency provided, return false
      if(typeof this.opts.timelapse === "undefined"){
        this.emit("start", "Error: must specify timelapse frequency option", new Date().getTime() );
        return false;
      }
      // if not timeout provided, set to longest possible
      if(typeof this.opts.timeout === "undefined"){
        this.opts.timeout = INFINITY_MS;
      }
      break;
//    case 'video':
//      cmd = VIDEO_CMD;
//      break;
    default:
      this.emit("start", "Error: mode must be photo, timelapse or video", new Date().getTime() );
      return false;
  }

  //start child process
  console.log('calling....');
  var fullcmd = cmd + ' ' + argstring;
  console.log(fullcmd);


  var self = this;
  this.child_process = exec(fullcmd, function(error, stdout, stderr) { 
    if (stderr !== null || error !== null) {
        //emit exit signal for process chaining over time
	console.log("stderr = "  + stderr);
        self.emit( "exit", stderr);
    } else {
        console.log("stdout = "  + stdout);
        //emit exit signal for process chaining over time
        self.emit( "exit", new Date().getTime() );
    }


    PROCESS_RUNNING_FLAG = false;
    self.child_process = null;
    child_process = null;
  });

  child_process = this.child_process;
  PROCESS_RUNNING_FLAG = true;


  this.emit("start", null, new Date().getTime() );
  return true;
  
};




// stop the child process
// return true if process was running, false if no process to kill
UvcCam.prototype.stop = function( ) {

  //close previous directory watcher if any
  if(this.watcher !== null){
    this.watcher.close();
  }

  if(PROCESS_RUNNING_FLAG){
    this.child_process.kill();
    child_process = null;
    PROCESS_RUNNING_FLAG = false;

    this.emit("stop", null, new Date().getTime() );
    return true;
  }else{
    this.emit("stop", "Error: no process was running", new Date().getTime());
    return false;
  }
};


/**
*
* addChildProcessListeners()
* 
* Adds listeners to the child process spawned to take pictures
* or record video (raspistill or raspivideo).
*
**/
UvcCam.prototype.addChildProcessListeners = function(){
  var self = this;
  var dout, derr;

  this.child_process.stdout.on('data', function (data) {
    console.log('stdout: ' + data);
    dout = data;
  });

  this.child_process.stderr.on('data', function (data) {
    console.log('stderr: ' + data);
    derr = data;
  });

  this.child_process.on('close', function (code) {    
    //emit exit signal for process chaining over time
    self.emit( "exit", new Date().getTime() );

    PROCESS_RUNNING_FLAG = false;
    self.child_process = null;
    child_process = null;
  });

};


/**
*
* getter
*
**/
UvcCam.prototype.get = function(opt){
  return this.opts[opt];
};


/**
*
* setter
*
**/
UvcCam.prototype.set = function(opt, value){
  this.opts[opt] = value;
  if(opt == "output"){
    //regenerate filepath, etc, with new output value
    this.derivativeOpts();
  }
};

module.exports = UvcCam;
