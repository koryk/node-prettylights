var dotenv = require('dotenv');
dotenv._getKeysAndValuesFromEnvFilePath('config/.env');
dotenv._setEnvs();


var lastjoin = Date.now();
var lastpart = Date.now();
var twitch_user = process.env.TWITCH_USER,
    twitch_oauth = process.env.TWITCH_OAUTH,
    twitch_channels = process.env.TWITCH_CHANNELS;

var irc = require('tmi.js'),
    hue = require("node-hue-api"),
    async = require('async'),
    _ = require('lodash'),
    Datastore = require('nedb');

var light_config = {user_lights:[1,3,9,4,5], notification_lights:[8,6]};

// initialize the db
var db = {};
db.hue = new Datastore({ filename: 'config/hue.db', autoload: true });
db.twitch = new Datastore({ filename: 'config/twitch.db', autoload: true });



// Initialize hue variables
var hueClass = hue.HueApi,
    hueApi = new hueClass();

var displayError = function(err) {
	console.error(err);
};


//TODO Make into configurable
var command_prefix = "!";
var light_command = "lights";
//command_prefix = ""; light_command = "mrdestructoid bionicbunion"
var color_command = "color";
var command_delimiter = " ";
var color_json_file = "color_file.json";
var fs = require('fs');
var color_map = {};
var command = command_prefix + light_command;
var info = [command + ' on|off|pretty|dim|bright',command +' color rgb|hsl <red|hue> <green|saturation> <blue|brightness> ',command + ' color <any color from wikipedia (no spaces or punctuation)>'];

fs.readFile(color_json_file, 'utf8', function (err, data) {
		obj = JSON.parse(data);
		new_obj = {};
		for (i in obj) {
			orig_val = obj[i];
			i = i.replace(/\W/g,'').toLowerCase();
			color_map[i] = orig_val;
		}
		console.dir(color_map);
		});

async.waterfall([
		function(callback){
		db.hue.find({_id: 'bridge'}, function (err, docs) {
			if(err) displayError(err);
			if(docs.length===0){
			// Bridge not found, let's find and add it
			hue.nupnpSearch().then(function(result){
				delete result[0]['id'];
				result[0]._id = 'bridge';
				// insert it into the db
				db.hue.insert(result, function (err, newDoc) {
					if(err) displayError(err);
					callback(null, newDoc.hostname);
					});
				}).done();
			} else {
			callback(null, docs[0]['ipaddress']);
			};
			});
		},
		function(hostname, callback){
			db.hue.find({_id: 'username'}, function (err, docs) {
					if(err) displayError(err);
					if(docs.length===0){
					hueApi.registerUser(hostname, null, 'Prettylights Twitch Bot')
					.then(function(result){
						// insert it into the db
						var doc = {};
						doc._id = 'username';
						doc.value = result;
						db.hue.insert(doc, function (err, newDoc) {
							if(err) displayError(err);
							callback(null, hostname, newDoc.value);
							});
						})
					.fail(displayError)
					.done();
					} else {
					callback(null, hostname, docs[0]['value']);
					}
					});
		}
], function (err, hostname, username) {
	var lightsApi = new hueClass(hostname, username);

	lightsApi.getFullState().then(function(result){
			_.forEach(result, function(value, name){
				var doc = value;
				doc._id = name;
				db.hue.insert(doc, function (err, newDoc) {
					if(err) return;
					});
				});

			twitchBot(lightsApi);
			}).done();
});

// Add the bot to channel(s) and listen for commands

var twitchBot = function(lightsApi){

	// Twitch client options...
	var client = new irc.client({
options: {
logging: {chat: true, enabled: true},
debug: true,
debugIgnore: ['ping', 'chat', 'action'],
tc: 3
},
identity: {
username: twitch_user,
password: twitch_oauth
},
channels: [twitch_channels]
});

var whiteState = function(){
	lightsApi.setGroupLightState(0, { 'on': true, 'ct': 200, 'bri': 180, 'effect': 'none' }, function(err, lights){
			if (err) throw err;
			});
}

var setLightsState = function(state, notify) {
	lights = light_config.user_lights;
	if (true === notify) {
		lights = light_config.notification_lights;
	}
	for (i = 0; i < lights.length; i++) {
		light_id = lights[i];
		try {
			lightsApi.setLightState(light_id, state, function(err, lights){
					console.dir(err);
					if (err) throw err;
					});
		} catch (e) {
			console.dir(e);
		} finally {
			//-_-;
		}
	}
}

//supports 3 methods
//0, 1, 2
//0 = RGB
//1 = HSL
//2 = XY
var COLOR_RGB = 0;
var COLOR_HSL = 1;
var COLOR_XY = 2;
var lightLightsColor = function(color, color_type) {

	var state = hue.lightState.create();
	color_type = color_type | 0;
	switch (color_type) {
		case COLOR_RGB:
			setLightsState( state.on().rgb(color))
				break;
		case COLOR_HSL:
			setLightsState( state.on().hsl(color))
				break;
		case COLOR_XY:
			setLightsState( state.on().xy(color))
				break;
	}
}

// Connect to the chat server..
client.connect();

var notifyLightsColor = function(color) {
	var state = hue.lightState.create();
	setLightsState( state.on().rgb(color), true);
}

client.on("join", function (channel, username) {
		now = Date.now();
		if (lastjoin + 100 >= now) return;
		lastjoin = now;
		var state = hue.lightState.create();
		setLightsState(state.on().rgb([0,255,0]).alert("select"), true);
		});

client.on("part", function (channel, username) {
		console.log("de-farted")
		now = Date.now();
		if (lastpart + 100 >= now) return;
		lastpart = now;
		var state = hue.lightState.create();
		setLightsState(state.on().rgb([255,30,30]).alert("select"), true);
		});

client.on("hosted", function (channel, username) {
		console.log ("Got a hosted event");
		var state = hue.lightState.create();
		setLightsState(state.on().rgb([0,255,0]).alert("lselect"), true);
		});

var handleCommand = function(command,channel) {
		//just the command, give info
		lowercase_message = command;
		if (lowercase_message === "" || lowercase_message === "help") {
			for (i=0;i<info.length;i++) {
				client.say(channel, info[i]);
			}
		}

		
		if (lowercase_message === 'dim') {
			state ={'bri_inc':-50}
			setLightsState(state);
		}
		if (lowercase_message === 'bright') {
			state ={'bri_inc':50}
			setLightsState(state);
		}

		if (lowercase_message === 'off') {
			state ={'on': false}
			setLightsState(state);
		}

		if (lowercase_message.startsWith(color_command)) {
			console.log("Color command");
			command_rest = lowercase_message.slice(color_command.length)
			command_rest = command_rest.trim();
			command_parts = command_rest.split(/\s+/);
			color_format = -1
			if (command_parts.length == 4) {
				if (command_parts[0] == "rgb") {
					color_format = COLOR_RGB;
				} else if (command_parts[0] == "hsl") {
					color_format = COLOR_RGB;
				} else if (command_parts[0] == "xy") {
					color_format = COLOR_RGB;
				} else {
					color_format = -1;
				}
				var myParseInt = function(i) {return parseFloat(i, 10); }
				color = command_parts.slice(1).map(myParseInt);
			}
			else if (command_parts.length == 1 && command_parts[0]!="") {
				color = command_parts[0];
				if (color in color_map) {
					color_format = COLOR_RGB;
					color = color_map[color];
					color = [color.r, color.b, color.g];
					console.dir(color);
				}
			}
			if (color_format != -1) {
				lightLightsColor(color, color_format);
			}
		}

		if (lowercase_message === 'random') {
			color = [parseInt(Math.random()*255),parseInt(Math.random()*255),parseInt(Math.random()*255)];
			color_format = COLOR_RGB;
			console.dir(color);
			lightLightsColor(color, color_format);
		}

		if (lowercase_message === ('white' || 'on')) {
			whiteState();
		}

		/*
		if (lowercase_message === 'pretty') {
			state = { 'on': true, 'effect': 'colorloop', 'bri': 180 }
			setLightsState(state);
		}*/
}

// Chat event listeners
client.on('chat', function (channel, user, message) {
		// * notification-lights: used for follow
		// * have it disco when someone follows
		if (message.length > 0) {
			lowercase_message = message.toLowerCase();
		}

		command_start = command_prefix + light_command;
		if (lowercase_message.startsWith(command_start)) {
			command_rest = lowercase_message.slice(command_start.length).trim();
			handleCommand(command_rest,channel);
		}
});
}
