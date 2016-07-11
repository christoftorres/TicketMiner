/** 
  -- StratumClient.js -- 
  Author : Christof Torres <christof.ferreira.001@student.uni.lu>
  Date   : June 2016
**/

var multiHashing = require('unomp-multi-hashing');
var Ethash       = require('ethashjs');
var levelup      = require('levelup');
var memdown      = require('memdown');
var bignum       = require('bignum');

var cacheDB = levelup('', {
  db : memdown
});

// StratumClient constructor
function StratumClient(config) {
    /* Debug mode */
    this.debug                 = true;

    /* Default config values */
    this.host                  = null;
	this.port                  = null;
	this.username              = null;
    this.password              = null;
    this.algorithm             = null;
    this.reversed_endiannes    = false; 

    /* Extend values from config argument */
    var whitelist = ['host', 'port', 'username', 'password', 'algorithm', 'reversed_endiannes'];
    if (!config) config = {};
    for (value in config) {
        if (whitelist.indexOf(value) != -1) {
            this[value] = config[value];
        }
    }

    /* Internal variables */
    this._connection           = null;
    this._retryPause           = 5;

    /* Stratum variables */
    this._query_id             = 1;
    this._stratum_queries      = {};
    this._subscription_details = null;
    this._authorized           = false;
    this._extranonce1          = null;
    this._extranonce2_size     = 0; 
    this._difficulty           = 0;
    this._target               = 0;
    this._jobs                 = [];

    // Shares
    this.receivedShares        = 0;
    this.registeredShares      = [];
    this.submittedShares       = 0;
    this.acceptedShares        = 0;
    this.rejectedShares        = 0;

    // Ethereum
    this._eth_timer            = null;
    this._eth_poll_time        = 30000;
    this._eth_current_header   = null;
    this._eth_current_seed     = null;
    this._eth_current_target   = null;
    this._eth_epoch            = null;
    this._eth_epoch_loaded     = false;
    this._ethash               = new Ethash(cacheDB);
};

StratumClient.NOTIFICATION = {
    CONNECTION_ERROR     : 0,
    AUTHENTICATION_ERROR : 1,
    COMMUNICATION_ERROR  : 2,
    NEW_WORK             : 3,
    NEW_DIFFICULTY       : 4,
    POW_TRUE             : 5,
    POW_FALSE            : 6
};

/* Start the stratum client */
StratumClient.prototype.start = function() {
    this.stop();
    this._startStratum();
};

/* Stop the stratum client */
StratumClient.prototype.stop = function() {
    this._stopStratum();
};

StratumClient.prototype.onEvent = function() {};

// Return the first clean job or the first job in our list of jobs 
StratumClient.prototype.getJob = function() {
    if (this._jobs.length > 0) {
        for (var i = 0; i < this._jobs.length; i++) {
            if (this._jobs[i].clean_jobs) {
                return this._jobs[i];
            }
        }
        return this._jobs[0];   
    } else {
        return null;
    }
};

// Submmit a share
StratumClient.prototype.submitJob = function(uuid, share, difficulty) {
    this.receivedShares++;
    var submitTime = Date.now() / 1000 | 0;
    for (index in this._jobs) {
        // Check if the submitted share is valid
        var job = this._jobs[index];
        if (this.algorithm == 'ethash') {
            if (share.header_hash == job.header_hash) {
                var result = this._ethash.run(new Buffer(share.header_hash, 'hex'), new Buffer(share.nonce, 'hex'));
                if (result.mix.toString('hex') != share.mixHash) {
                    break;
                }
                var hashBigNum = new bignum(result.hash.toString('hex'), 16);
                var share_target = bignum.pow(2, 256).div(bignum(difficulty));
                if (hashBigNum.gt(share_target)) {
                    break;
                }
                // Share is valid, now store the share in order to prevent duplicates
                if (!this._registerSubmit(share)) {
                    break;
                }
                // Submit share to the mining pool if it meets the pool's difficulty
                if (hashBigNum.le(new bignum(this._target.toString(), 16))) {
                    // Submit the share to the mining pool
                    this._stratumSend({
                        method: "eth_submitWork", params: [
                            share.nonce, 
                            share.header_hash, 
                            share.mixHash
                        ]
                    }, function(message) {
                        if (!message.error) {
                            if (message.result) {
                                // Share got accepted by the mining pool
                                this.acceptedShares++;
                            } else {
                                // Share got rejected by the mining pool
                                this.rejectedShares++;
                            }
                        } else {
                            // An error occured and therefore is the share rejected
                            this._logger("[Stratum] Error: "+message.error);    
                            this.rejectedShares++;
                        }
                    }.bind(this));
                    // Increment the number of submitted shares to the mining pool
                    this.submittedShares++;
                }
                // Notify the miner about the valid share
                this._notify({ notification: StratumClient.NOTIFICATION.POW_TRUE, uuid: uuid });
                return true;
            }
        } else
        if (share.job_id == job.job_id) {
            // Check the validity of the extranone2 value
            if (share.extranonce2.length / 2 !== this._extranonce2_size) {
                break;
            }
            // Check the validity of the nTime value
            if (share.ntime.length !== 8) {
                break;
            }
            var nTimeInt = parseInt(share.ntime, 16);
            if (nTimeInt < job.ntime || nTimeInt > submitTime + 7200) {
                break;
            }
            // Add a zero padding to the nonce we received
            share.nonce = this._zeropad(share.nonce.toString(16), 8);
            /* Build coinbase transaction */
            var coin_base = job.coinb1 + this._extranonce1 + share.extranonce2 + job.coinb2;
            /* Build merkle root */
            var merkle_root = CryptoJS.SHA256(CryptoJS.SHA256(CryptoJS.enc.Hex.parse(coin_base)));
            for (var i in job.merkle_branch) {
                var final_merkle_root = merkle_root.concat(CryptoJS.enc.Hex.parse(job.merkle_branch[i]));
                merkle_root = CryptoJS.SHA256(CryptoJS.SHA256(final_merkle_root));
            }
            merkle_root = merkle_root.swap_bytes().toString(CryptoJS.enc.Hex);
            /* Build block header */
            var block_header = CryptoJS.enc.Hex.parse([job.version, job.prevhash, merkle_root, share.ntime, job.nbits, share.nonce].join(""));
            if (!this.reversed_endiannes) {
                block_header.swap_bytes();
            }
            var hash = hashBigNum = null;
            if (this.algorithm == 'scrypt') {
                hash = multiHashing.scrypt(new Buffer(block_header.toString(), "hex"), 1024, 1);
                hashBigNum = bignum.fromBuffer(hash, {endian: 'little', size: 32});
            } else
            if (this.algorithm == 'neoscrypt') {
                hash = multiHashing.neoscrypt(new Buffer(block_header.toString(), "hex"));
                hashBigNum = bignum.fromBuffer(hash, {endian: 'little', size: 32});
            } else
            if (this.algorithm == 'sha256') {
                hash = CryptoJS.SHA256(CryptoJS.SHA256(block_header));
                hashBigNum = new bignum(hash.toString(), 16);
            }
            // Check if share meets the requested difficulty
            var share_target = this._calculateTarget(difficulty).reverse();
            if (hashBigNum.gt(new bignum(share_target.toString(), 16))) {
                break;
            }
            // SHare is valid, now store the share in order to prevent duplicates
            if (!this._registerSubmit(share)) {
                break;
            }
            // Check if share meets the difficulty of the mining pool
            if (hashBigNum.le(new bignum(this._target.toString(), 16))) {
                // Submit the share to the mining pool
                this._stratumSend({
                    method: "mining.submit", params: [
                        this.username,
                        share.job_id,
                        share.extranonce2,
                        share.ntime,
                        share.nonce
                    ]
                }, function(message) {
                    if (!message.error) {
                        if (message.result) {
                            // Share got accepted by the mining pool
                            this.acceptedShares++;
                        } else {
                            // Share got rejected by the mining pool
                            this.rejectedShares++;
                        }
                    } else {
                        // An error occured and therefore is the share rejected
                        switch(message.error[0]) {
                            case 21:
                                this._logger("[Stratum] Error 21 - Job not found (or stale)");
                                break;
                            case 22:
                                this._logger("[Stratum] Error 22 - Duplicate share");
                                break;
                            case 23:
                                this._logger("[Stratum] Error 23 - Low difficulty share");
                                break;
                            case 24:
                                this._logger("[Stratum] Error 24 - Unauthorized worker");
                                break;
                            case 25:
                                this._logger("[Stratum] Error 25 - Not subscribed");
                                break;
                            default:
                                this._logger("[Stratum] Error "+message.error[0]+" - "+message.error[1]);
                                break;
                        }
                        this.rejectedShares++;
                    }
                }.bind(this));
                // Increment the number of submitted shares to the mining pool
                this.submittedShares++;
            }
            // Notify the miner about the valid share
            this._notify({ notification: StratumClient.NOTIFICATION.POW_TRUE, uuid: uuid });
            return true;
        }
    }
    // Notify the miner about the invalid share
    this._notify({ notification: StratumClient.NOTIFICATION.POW_FALSE, uuid: uuid });    
    return false;
};

/* Private internal functions */

// Start stratum connection to mining pool
StratumClient.prototype._startStratum = function(retryPause) {
    var retryPause = retryPause || this._retryPause;
    var connection = this._connection = new require('net').Socket();
    // Create a socket connection
    connection.connect(this.port, this.host, function() {
        this._logger("[Stratum] Connected to '"+this.host+":"+this.port+"'");
        retryPause = this._retryPause;
        /* Subscribe */
        this._logger("[Stratum] Subscribing...");
        var subscription = new Object();
        if (this.algorithm == 'ethash') {
            subscription.method = "eth_login";
            subscription.params = [this.username, this.password];
        } else {
            subscription.method = "mining.subscribe";
            subscription.params = [];
        }
        this._stratumSend(subscription, function(message) {
            if (!message.error && message.result) {
                this._subscription_details = message.result[0];
                this._extranonce1          = message.result[1]; 
                this._extranonce2_size     = message.result[2];
                //this._subscription_details = ["mining.notify", "ae6812eb4cd7735a302a8a9dd95cf71f"];
                //this._extranonce1          = "f8002c90"; 
                //this._extranonce2_size     = 4
                this._logger("[Stratum] Subscription was successful!");
                if (this.algorithm == 'ethash') {
                    this._authorized = message.result;
                    this._eth_timer = setInterval(function() {
                        if (this._connection != null && this._authorized) {
                            this._stratumSend({ method: "eth_getWork", params: [] }, function(message) {
                                //var seed_hash = "1730dd810f27fdefcac730fcab75814b7286002ecf541af5cdf7875440203215";
                                //var seed_hash = "290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563";
                                var seed_hash = message.result[1].substring(2, message.result[1].length);
                                if (this._eth_current_seed != seed_hash) {
                                    this._eth_current_seed = seed_hash;
                                    // Compute new epoch
                                    this._eth_epoch = 0;
                                    var hash = new Buffer(32).fill(0x00);
                                    while (hash.toString('hex') != seed_hash) {
                                        hash = multiHashing.keccak(hash);
                                        this._eth_epoch++;
                                    }
                                    // Compute new cache
                                    this._eth_epoch_loaded = false;
                                    this._logger("[Stratum] Computing new cache (epoch "+this._eth_epoch+")...");
                                    this._ethash.loadEpoc(this._eth_epoch*30000, function() {
                                        this._eth_epoch_loaded = true;
                                        this._logger("[Stratum] Cache successfully computed!");
                                    }.bind(this));
                                } else 
                                if (this._eth_epoch_loaded) {
                                    //var header_hash = "f5afa3074287b2b33e975468ae613e023e478112530bc19d4187693c13943445";
                                    //var header_hash = "0e2887aa1a0668bf8254d1a6ae518927de99e3e5d7f30fd1f16096e2608fe05e";
                                    var header_hash = message.result[0].substring(2, message.result[0].length);
                                    if (this._eth_current_header != header_hash) {
                                        this._eth_current_header = header_hash;
                                        //this._target = "00000000000baef6895d630131521d65d984555906990f43f352be4350291f92";
                                        //this._target = "000000023d931d0c92464d90d41f608a148a62132792565b105d856e80dbbe28";
                                        this._target = message.result[2].substring(2, message.result[2].length);
                                        // Add zero padding to the target
                                        this._target = this._zeropad(this._target, 64);
                                        // Compute the difficulty out of the target
                                        var difficulty = bignum.pow(2, 256).div(bignum(this._target, 16)).toString();
                                        if (this._difficulty != difficulty) {
                                            this._difficulty = difficulty
                                            this._notify({ notification: StratumClient.NOTIFICATION.NEW_DIFFICULTY, difficulty : this._difficulty });
                                        }
                                        var job = {
                                            header_hash  : header_hash,
                                            seed_hash    : seed_hash,
                                            target       : this._target,
                                            epoch        : this._eth_epoch
                                        };
                                        this._jobs = [];
                                        this._jobs.push(job);
                                        this._notify({ notification: StratumClient.NOTIFICATION.NEW_WORK, job: job });
                                    }
                                }
                            }.bind(this));
                        }
                    }.bind(this) , this._eth_poll_time);
                } else {
                    /* Authorization */
                    this._logger("[Stratum] Authorizing worker...");
                    this._stratumSend({ method: "mining.authorize", params: [this.username, this.password] }, function(message) {
                        this._authorized = message.result;
                        if (!message.error && this._authorized) {
                            this._logger("[Stratum] Worker authorization was successful!");
                        } else {
                            this._notify({ notification: StratumClient.NOTIFICATION.AUTHENTICATION_ERROR });
                            this._logger("[Stratum] Error: "+message.error);
                            this.stop();
                        }
                    }.bind(this));
                }
            } else {
                this._notify({ notification: StratumClient.NOTIFICATION.COMMUNICATION_ERROR });
                this._logger("[Stratum] Error: "+message.error);
                this.stop();
            }
        }.bind(this));
    }.bind(this));
    // Add a 'data' event handler for the client socket
    // data is what the server sent to this socket
    connection.on('data', function(data) {
        this._stratumReceive(data);
    }.bind(this));
    // Add a 'close' event handler for the client socket
    connection.on('close', function() {
        this._logger("[Stratum] Connection closed!");
    }.bind(this));
    // Must be specified per EventEmitter requirements
    connection.on('error', function() {
        this._logger("[Stratum] An error occured!");
        this._notify({ retryPause: retryPause, notification: StratumClient.NOTIFICATION.CONNECTION_ERROR });
        setTimeout(function() {
            this._startStratum(retryPause*2);
        }.bind(this), retryPause*1000);
    }.bind(this));  
};

// Stop stratum connection to mining pool
StratumClient.prototype._stopStratum = function() {
    if (this._connection != null) {
        this._connection.destroy();
        this._connection           = null;
        this._retryPause           = 5;
        this._query_id             = 1;
        this._stratum_queries      = {};
        this._subscription_details = null;
        this._authorized           = false;
        this._extranonce1          = null;
        this._extranonce2_size     = 0; 
        this._difficulty           = 0;
        this._target               = 0;
        this._jobs                 = [];
    }
    if (this.algorithm == 'ethash') {
        if (this._eth_timer != null) {
            clearInterval(this._eth_timer);
        }
    }
};

// Send stratum message back to mining pool
StratumClient.prototype._stratumSend = function(message, callback) {
    message.id = this._query_id++;
    if (this.algorithm == 'ethash') {
        message.jsonrpc = "2.0";
    }
    this._stratum_queries[message.id] = callback;
    this._connection.write(JSON.stringify(message) + "\n");
};

// Receive stratum message from mining pool
StratumClient.prototype._stratumReceive = function(message) {
    // Parse incoming message for commands...
    var commands = String(message).split('\n');
    // Loop through commands...
    for (var index in commands) {
        var cmd = commands[index];
        // Check if command is valid
        if (cmd) {
            try {
                data = JSON.parse(cmd);
            } catch(e) {
                this._logger("[Stratum] Malformed response: %s", cmd);
                return;
            }
            // Response to request
            if (data.id) {
                if (this._stratum_queries[data.id]) {
                    this._stratum_queries[data.id](data);
                    delete this._stratum_queries[data.id];
                } else 
                if (data.method == "client.get_version") {
                    var message = { id : data.id, result : "ticketminer/0.0.1", error : null };
                    this._connection.write(JSON.stringify(message) + "\n");
                } else {
                    this._logger("[Stratum] Unknown response: %s", cmd);
                }
            // Notification
            } else {
                if (data.method == "mining.set_difficulty") {
                    this._difficulty = data.params[0];
                    //this._difficulty = 32;
                    this._target = this._calculateTarget(this._difficulty).reverse();
                    this._notify({ notification: StratumClient.NOTIFICATION.NEW_DIFFICULTY, difficulty : this._difficulty });
                } else 
                if (data.method == "mining.notify") {
                    for (var index in this._jobs) {
                        if (this._jobs[index].job_id == data.params[0]) {
                            return; 
                        }
                    }
                    this._newJob(data);
                }
            }
        }
    }
};

// Create a new mining job
StratumClient.prototype._newJob = function(data) {
    var job = {
        job_id             : data.params[0],
        prevhash           : data.params[1],
        coinb1             : data.params[2],
        coinb2             : data.params[3],
        merkle_branch      : data.params[4],
        version            : data.params[5],
        nbits              : data.params[6],
        ntime              : data.params[7],
        clean_jobs         : data.params[8],
        extranonce1        : this._extranonce1,
        extranonce2        : 0x00000000,
        extranonce2_size   : this._extranonce2_size,
        reversed_endiannes : this.reversed_endiannes
    };
    // Scrypt test example
    /*var job = {
        job_id             : "b3ba",
        prevhash           : "7dcf1304b04e79024066cd9481aa464e2fe17966e19edf6f33970e1fe0b60277",
        coinb1             : "01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff270362f401062f503253482f049b8f175308",
        coinb2             : "0d2f7374726174756d506f6f6c2f000000000100868591052100001976a91431482118f1d7504daf1c001cbfaf91ad580d176d88ac00000000",
        merkle_branch      : [ 
                                "57351e8569cb9d036187a79fd1844fd930c1309efcd16c46af9bb9713b6ee734", 
                                "936ab9c33420f187acae660fcdb07ffdffa081273674f0f41e6ecc1347451d23"
                             ],
        version            : "00000002",
        nbits              : "1b44dfdb",
        ntime              : "53178f9f",
        clean_jobs         : true,
        extranonce1        : "f8002c90",
        extranonce2        : 0x00000002,
        extranonce2_size   : this._extranonce2_size,
        reversed_endiannes : this.reversed_endiannes
    };*/
    if (job.clean_jobs) {
        this._jobs = [];
    }
    this._jobs.push(job);
    this._notify({ notification: StratumClient.NOTIFICATION.NEW_WORK, job: job });                  
};

// Check if share was already submitted and register if not
StratumClient.prototype._registerSubmit = function(share) {
    for (var index in this.registeredShares) {
        var registeredShare = this.registeredShares[index];
        if (this.algorithm == 'ethash')
            if (registeredShare.header_hash == share.header_hash && 
                registeredShare.mixHash     == share.mixHash     &&
                registeredShare.nonce       == share.nonce)
                return false;
        else
            if (registeredShare.job_id      == share.job_id      &&      
                registeredShare.extranonce2 == share.extranonce2 &&
                registeredShare.ntime       == share.ntime       &&
                registeredShare.nonce       == share.nonce)
                return false;    
    }
    this.registeredShares.push(share);
    return true; 
};

// Notify the mainlogic about happening events
StratumClient.prototype._notify = function(data) {
    var notification = data.notification;
    var message = data.message;
    if (notification != null) {
        switch (notification) {
            case StratumClient.NOTIFICATION.CONNECTION_ERROR:     message = 'Connection error, retrying in ' + data.retryPause + ' seconds.'; break;
            case StratumClient.NOTIFICATION.AUTHENTICATION_ERROR: message = 'Invalid worker username or password.'; break;
            case StratumClient.NOTIFICATION.COMMUNICATION_ERROR:  message = 'Communication error.'; break;
            case StratumClient.NOTIFICATION.NEW_WORK:             
                if (this.algorithm == 'ethash')
                    message = 'Server sends new mining job: 0x'+data.job.header_hash;
                else
                    message = 'Server sends new mining job: 0x'+data.job.job_id+' ('+data.job.clean_jobs+')';
                break;
            case StratumClient.NOTIFICATION.NEW_DIFFICULTY:       message = 'Server asks to change share difficulty: '+data.difficulty; break;
            case StratumClient.NOTIFICATION.POW_TRUE:             message = 'Share was accepted!'; break;
            case StratumClient.NOTIFICATION.POW_FALSE:            message = 'Share was rejected!'; break;
        }
    }
    if (message) {
        this._logger("[Stratum] "+message);
        data.message = message;
    }
    this.onEvent(data);
}

/* Taken from CPU-Miner source code */

StratumClient.BLOCK_HEADER_PADDING          = '000000800000000000000000000000000000000000000000000000000000000000000000000000000000000080020000';
StratumClient.REVERSED_BLOCK_HEADER_PADDING = '800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000280';

// Calculate the target based on the mining algorithm and difficulty
StratumClient.prototype._calculateTarget = function(difficulty) {
    if (this.algorithm.indexOf('scrypt') != -1) {
        difficulty /= 65536.0;
    }
    for (var k = 6; k > 0 && difficulty > 1.0; k--)
        difficulty /= 4294967296.0;
    var m = 4294901760.0 / difficulty;
    var target = [0, 0, 0, 0, 0, 0, 0, 0];
    target[k] = m & 0xffffffff;
    target[k + 1] = (m / 0xffffffff) | 0;
    return new CryptoJS.lib.WordArray.init(target, 32).swap_bytes();
}

// Get the block header padding for the current job
StratumClient.prototype._get_block_header_padding = function(reversed_endiannes) {
    return reversed_endiannes ? StratumClient.REVERSED_BLOCK_HEADER_PADDING : StratumClient.BLOCK_HEADER_PADDING;
}

// Add zero padding to a number given a certain length
StratumClient.prototype._zeropad = function(num, length) {
    return (Array(length).join('0') + num).slice(length*-1);
}

StratumClient.prototype._logger = function() {
    if (this.debug) {
        try {
            console.log.apply(console, Array.prototype.slice.call(arguments, 0));
        } catch(e) {

        };
    }
};

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

CryptoJS.lib.WordArray.__proto__.swap_bytes = function() {
    for (var i = 0; i < this.words.length; i++) {
        var dword = this.words[i];
        this.words[i] = ((dword>>24)&0xff) | // move byte 3 to byte 0
                    ((dword<<8)&0xff0000)  | // move byte 1 to byte 2
                    ((dword>>8)&0xff00)    | // move byte 2 to byte 1
                    ((dword<<24)&0xff000000);
    }
    return this;
}

CryptoJS.lib.WordArray.__proto__.reverse = function() {
    var result = CryptoJS.enc.Hex.parse(this.toString());
    for (var i = 0; i < this.words.length; i++) {
        var dword = this.words[i];
        result.words[this.words.length-(i+1)] = ((dword>>24)&0xff) | // move byte 3 to byte 0
                                            ((dword<<8)&0xff0000)  | // move byte 1 to byte 2
                                            ((dword>>8)&0xff00)    | // move byte 2 to byte 1
                                            ((dword<<24)&0xff000000);
    }
    this.words = result.words;
    return this;
}

module.exports = StratumClient;
