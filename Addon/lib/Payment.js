/** 
  -- Payment.js -- 
  Author : Christof Torres <christof.ferreira.001@student.uni.lu>
  Date   : June 2016
**/

var connection     = new WebSocket(self.options['server'], ['ticket-miner-protocol']);
var schnorr        = null;
var challenge      = null;
var returnTicket   = new Object();
var returnValue    = 0.0;
var secretHash     = null;
var ticketsValid   = false;
var serverResponse = null;

// Open a websocket connection to the given server
connection.onopen = function() {
	if (self.options['type'] == 'donation') {
		// Send a donation request to the server
		connection.send(JSON.stringify({ command : 'DONATION' }));
	} else
	if (self.options['type'] == 'purchase') {
		// Send a purchase request to the server together with the item ID
    	connection.send(JSON.stringify({ command : 'PURCHASE', data : { itemID : self.options['itemID'] } }));
	}
};

// Listen to messages coming from the server
connection.onmessage = function(event) {
	var message = JSON.parse(event.data);
    if (message.command == 'DONATION') {
    	// Forward the donation response back to the main logic
		self.port.emit("donation-response", message.data);
	} else
	if (message.command == 'PURCHASE') {
		// Forward the purchase response back to the main logic
		self.port.emit("purchase-response", message.data);
	} else
	// Server confirms that the submitted tickets are valid
	if (message.command == 'TICKETS_VALID') {
		// Directly notify the main logic that the payment was valid if no return ticket is expected
		if (returnValue == 0.0) {
			self.port.emit("payment-valid", message.data);
		} else {
			// Otherwise wait for the return ticket by confirming the validation and storing the server response 
			ticketsValid   = true;
			serverResponse = message.data;
		}
	} else 
	if (message.command == 'TICKET_ERROR') {
		// Notify the main logic about an error that occured on the serverside
		self.port.emit("payment-error", message.data);
	}
	// This code is responsable for constructing the return ticket between the client and the server:
	// -- WISchnorr protocol begin --
    if (message.command == 'WISCHNORR_PARAMS') {
        var info = message.data.info;
        // Check if the received 'info' is valid
        if (info.hash == secretHash && info.value == returnValue && info.timestamp == moment.utc().startOf('day').unix() && info.expiration > info.timestamp) {
            returnTicket['info'] = info;
            // Generate the challenge for the server
            challenge = schnorr.GenerateWISchnorrClientChallenge(message.data.params, JSON.stringify(returnTicket.info), returnTicket.secret);
            // Send the challenge to the server
            connection.send(JSON.stringify({ command : 'WISCHNORR_CLIENT_CHALLENGE', data : { e : challenge.e } }));
        } else {
        	// Notify the main logic about the invalid 'info'
        	self.port.emit("payment-error", 5);
        }
    } else
    if (message.command == 'WISCHNORR_SERVER_RESPONSE') {
        // Create the ticket signature based on the server reponse to the client challenge
        returnTicket['signature'] = schnorr.GenerateWISchnorrBlindSignature(challenge.t, message.data.response);
        // Verify the signature
        if (schnorr.VerifyWISchnorrBlindSignature(returnTicket.signature, JSON.stringify(returnTicket.info), returnTicket.secret)) {
            // If the signature is valid, notify the user about the new return ticket and that the payment was successful
            self.port.emit("new-ticket", returnTicket);
            returnValue == 0.0;
            if (ticketsValid) {
            	self.port.emit("payment-valid", serverResponse);
            }
        } else {
        	// Notify the main logic about the invalid signature
            self.port.emit("payment-error", 5);
        }
    }
    // -- WISchnorr protocol end --
};

// Notify the main logic about the connection error
connection.onerror = function(event) {
    self.port.emit("payment-connection-error");
};

// It's mandatory to add at least an empty function to the 'onclose' event, even though it's not used
connection.onclose = function(event) {};

// Create a return ticket based on the difference between the total of the tickets and the amount to pay
function submit(tickets, amount) {
	// Compute the total of the tickets
	var total = 0.0;
	for (var index in tickets) {
		total += parseFloat(tickets[index].info.value);
	}
	// Notify the main logic that the total is zero
	if (total == 0.0) {
		self.port.emit("payment-error", 3);
		return false;
	}
	secretHash = null;
	// If the total is not equal to the amount, then we expect a return ticket
	if (parseFloat(total) != parseFloat(amount)) {
		// Create a secret x
		var array = new Uint32Array(8);
	    window.crypto.getRandomValues(array);
	    var x = '';
	    for (var i = 0; i < array.length; i++) {
	        x += array[i];
	    } 
	    // Iniitalize the return ticket   
	    returnTicket['origin']    = tickets[0].origin;
        returnTicket['publicKey'] = tickets[0].publicKey;        
	    returnTicket['secret']    = x;
	    // Compute the hash of x
	    secretHash  = CryptoJS.SHA256(x).toString();
	    // Initialize the WISchnorr protocol
	    schnorr     = new WISchnorrClient(returnTicket.publicKey);
	    // Compute the return value based on the difference between the total and the amount
	    returnValue = parseFloat(total) - parseFloat(amount);
	} else {
		// Create an empty return ticket and a zero return value
		returnTicket = {};
		returnValue  = 0.0;
	}
	return true;
}

// Listen to donation submissions
self.port.once("submit-donation", function(tickets, amount) {
	if (submit(tickets, amount)) {
		// Submit tickets, amount and secret hash to the server
		connection.send(JSON.stringify({ command : 'SUBMIT_TICKETS', data : { type : 'donation', tickets : tickets, amount : amount, hash : secretHash } }));
	}
});

// Listen to purchase submissions
self.port.once("submit-purchase", function(tickets, amount) {
	if (submit(tickets, amount)) {
		// Submit tickets, amount, item ID and secret hash to the server
		connection.send(JSON.stringify({ command : 'SUBMIT_TICKETS', data : { type : 'purchase', tickets : tickets, amount : amount, itemID : self.options['itemID'], hash : secretHash } }));
	}
});

// Listen to 'detach' events when a payment is destroyed
self.port.on("detach", function() {
	// Close the connection
	connection.close();
	// Free up memory
   	connection = null;
  	window.close();
});

/*
CryptoJS v3.1.2
code.google.com/p/crypto-js
(c) 2009-2013 by Jeff Mott. All rights reserved.
code.google.com/p/crypto-js/wiki/License
*/
var CryptoJS=CryptoJS||function(h,s){var f={},t=f.lib={},g=function(){},j=t.Base={extend:function(a){g.prototype=this;var c=new g;a&&c.mixIn(a);c.hasOwnProperty("init")||(c.init=function(){c.$super.init.apply(this,arguments)});c.init.prototype=c;c.$super=this;return c},create:function(){var a=this.extend();a.init.apply(a,arguments);return a},init:function(){},mixIn:function(a){for(var c in a)a.hasOwnProperty(c)&&(this[c]=a[c]);a.hasOwnProperty("toString")&&(this.toString=a.toString)},clone:function(){return this.init.prototype.extend(this)}},
q=t.WordArray=j.extend({init:function(a,c){a=this.words=a||[];this.sigBytes=c!=s?c:4*a.length},toString:function(a){return(a||u).stringify(this)},concat:function(a){var c=this.words,d=a.words,b=this.sigBytes;a=a.sigBytes;this.clamp();if(b%4)for(var e=0;e<a;e++)c[b+e>>>2]|=(d[e>>>2]>>>24-8*(e%4)&255)<<24-8*((b+e)%4);else if(65535<d.length)for(e=0;e<a;e+=4)c[b+e>>>2]=d[e>>>2];else c.push.apply(c,d);this.sigBytes+=a;return this},clamp:function(){var a=this.words,c=this.sigBytes;a[c>>>2]&=4294967295<<
32-8*(c%4);a.length=h.ceil(c/4)},clone:function(){var a=j.clone.call(this);a.words=this.words.slice(0);return a},random:function(a){for(var c=[],d=0;d<a;d+=4)c.push(4294967296*h.random()|0);return new q.init(c,a)}}),v=f.enc={},u=v.Hex={stringify:function(a){var c=a.words;a=a.sigBytes;for(var d=[],b=0;b<a;b++){var e=c[b>>>2]>>>24-8*(b%4)&255;d.push((e>>>4).toString(16));d.push((e&15).toString(16))}return d.join("")},parse:function(a){for(var c=a.length,d=[],b=0;b<c;b+=2)d[b>>>3]|=parseInt(a.substr(b,
2),16)<<24-4*(b%8);return new q.init(d,c/2)}},k=v.Latin1={stringify:function(a){var c=a.words;a=a.sigBytes;for(var d=[],b=0;b<a;b++)d.push(String.fromCharCode(c[b>>>2]>>>24-8*(b%4)&255));return d.join("")},parse:function(a){for(var c=a.length,d=[],b=0;b<c;b++)d[b>>>2]|=(a.charCodeAt(b)&255)<<24-8*(b%4);return new q.init(d,c)}},l=v.Utf8={stringify:function(a){try{return decodeURIComponent(escape(k.stringify(a)))}catch(c){throw Error("Malformed UTF-8 data");}},parse:function(a){return k.parse(unescape(encodeURIComponent(a)))}},
x=t.BufferedBlockAlgorithm=j.extend({reset:function(){this._data=new q.init;this._nDataBytes=0},_append:function(a){"string"==typeof a&&(a=l.parse(a));this._data.concat(a);this._nDataBytes+=a.sigBytes},_process:function(a){var c=this._data,d=c.words,b=c.sigBytes,e=this.blockSize,f=b/(4*e),f=a?h.ceil(f):h.max((f|0)-this._minBufferSize,0);a=f*e;b=h.min(4*a,b);if(a){for(var m=0;m<a;m+=e)this._doProcessBlock(d,m);m=d.splice(0,a);c.sigBytes-=b}return new q.init(m,b)},clone:function(){var a=j.clone.call(this);
a._data=this._data.clone();return a},_minBufferSize:0});t.Hasher=x.extend({cfg:j.extend(),init:function(a){this.cfg=this.cfg.extend(a);this.reset()},reset:function(){x.reset.call(this);this._doReset()},update:function(a){this._append(a);this._process();return this},finalize:function(a){a&&this._append(a);return this._doFinalize()},blockSize:16,_createHelper:function(a){return function(c,d){return(new a.init(d)).finalize(c)}},_createHmacHelper:function(a){return function(c,d){return(new w.HMAC.init(a,
d)).finalize(c)}}});var w=f.algo={};return f}(Math);
(function(h){for(var s=CryptoJS,f=s.lib,t=f.WordArray,g=f.Hasher,f=s.algo,j=[],q=[],v=function(a){return 4294967296*(a-(a|0))|0},u=2,k=0;64>k;){var l;a:{l=u;for(var x=h.sqrt(l),w=2;w<=x;w++)if(!(l%w)){l=!1;break a}l=!0}l&&(8>k&&(j[k]=v(h.pow(u,0.5))),q[k]=v(h.pow(u,1/3)),k++);u++}var a=[],f=f.SHA256=g.extend({_doReset:function(){this._hash=new t.init(j.slice(0))},_doProcessBlock:function(c,d){for(var b=this._hash.words,e=b[0],f=b[1],m=b[2],h=b[3],p=b[4],j=b[5],k=b[6],l=b[7],n=0;64>n;n++){if(16>n)a[n]=
c[d+n]|0;else{var r=a[n-15],g=a[n-2];a[n]=((r<<25|r>>>7)^(r<<14|r>>>18)^r>>>3)+a[n-7]+((g<<15|g>>>17)^(g<<13|g>>>19)^g>>>10)+a[n-16]}r=l+((p<<26|p>>>6)^(p<<21|p>>>11)^(p<<7|p>>>25))+(p&j^~p&k)+q[n]+a[n];g=((e<<30|e>>>2)^(e<<19|e>>>13)^(e<<10|e>>>22))+(e&f^e&m^f&m);l=k;k=j;j=p;p=h+r|0;h=m;m=f;f=e;e=r+g|0}b[0]=b[0]+e|0;b[1]=b[1]+f|0;b[2]=b[2]+m|0;b[3]=b[3]+h|0;b[4]=b[4]+p|0;b[5]=b[5]+j|0;b[6]=b[6]+k|0;b[7]=b[7]+l|0},_doFinalize:function(){var a=this._data,d=a.words,b=8*this._nDataBytes,e=8*a.sigBytes;
d[e>>>5]|=128<<24-e%32;d[(e+64>>>9<<4)+14]=h.floor(b/4294967296);d[(e+64>>>9<<4)+15]=b;a.sigBytes=4*d.length;this._process();return this._hash},clone:function(){var a=g.clone.call(this);a._hash=this._hash.clone();return a}});s.SHA256=g._createHelper(f);s.HmacSHA256=g._createHmacHelper(f)})(Math);
