/** 
  -- Miner.js -- 
  Author : Christof Torres <christof.ferreira.001@student.uni.lu>
  Date   : June 2016
**/

// Create a miner instance based on the options received by the main logic
var miner = new Miner({
    debug   : self.options['debug'],
    server  : self.options['server'],
    threads : self.options['threads'],
    donate  : self.options['donate']
});

// Listen to 'start-minig' events
self.port.on('start-mining', function() {
    // Start the miner instance
    miner.start();
}.bind(miner));

// Listen to 'stop-minig' events
self.port.on('stop-mining', function() {
    // Stop the miner instance
    miner.stop();
}.bind(miner));

// Listen to 'set-ethash-client' events
self.port.on('set-ethash-client', function(client) {
    // Set the new Ethash client type
    miner._eth.client = client;
    // Free up the current Ethash data for deletion
    miner._eth.data = null;
}.bind(miner));

// Listen to 'load-ethash-data' events
self.port.on('load-ethash-data', function(decoding) {
    if (decoding) {
        // Encode the received data back to an array
        var data = new Uint16Array(new ArrayBuffer(decoding.length * 2));
        for (var i = 0, e = decoding.length; i < e; ++i) data[i] = decoding.charCodeAt(i);
        // Store the array
        miner._eth.data = new Uint32Array(data.buffer);
        // Start workers in order to start mining
        for (var i = 0; i < miner.threads; i++) {
            var worker = miner._createWorker(miner._job, i);
            worker.postMessage({ 'cmd' : 'start' });
            miner._workers.push(worker);
        }
        miner.running = true;
        miner._notify({ notification: Miner.NOTIFICATION.STARTED });
    } else {
        // Create and start an Ethash worker in order to compute the missing data
        miner._eth.worker = this._createEthashWorker();
        miner._eth.worker.postMessage({ 'cmd' : 'start' });
    }   
}.bind(miner));

// Constructor for the miner
function Miner(config) {
    /* Default config values */
    this.debug   = false;
    this.server  = null;
    this.threads = 1;
    this.donate  = true;

    /* Extend values from config argument */
    var whitelist = ['debug', 'server', 'threads', 'donate'];
    if (!config) config = {};
    for (value in config) {
        if (whitelist.indexOf(value) != -1) {
            this[value] = config[value];
        }
    }

    /* Internal variables */
    this.running         = false;
    this.retry           = false;
    
    this._retryPause     = 5;
    this._connection     = null;
    this._connected      = false;
    this._algorithm      = null;
    this._job            = null;
    this._difficulty     = 0;
    this._workers        = [];
    
    // Hash rate
    this._startTime      = 0;
    this._statTime       = Date.now();
    this._statHashes     = 0;
    this.hashRate        = 0;
    this.avgHashRate     = null;
    this.totalHashes     = 0;

    // Shares
    this.submittedShares = 0;
    this.acceptedShares  = 0;
    this.rejectedShares  = 0;

    // Ticket system
    this._ticket         = {};
    this._schnorr        = null;
    this._challenge      = null;

    // Ethereum
    this._eth            = {};
    this._eth.seedHash   = null;
    this._eth.worker     = null;
    this._eth.client     = null;
    this._eth.data       = null;
}

Miner.NOTIFICATION = {
    CONNECTION_ERROR     : 0,
    STARTED              : 1,
    TERMINATED           : 2,
    NEW_JOB              : 3,
    SHARE_FOUND          : 4,
    SHARE_ACCEPTED       : 5,
    SHARE_REJECTED       : 6,
    STATISTIC            : 7,
    WORKER_DEBUG         : 8
};

// Hashrate update interval (after a number of hashes)
Miner._STATISTIC_INTERVAL = 100;

/* Start the miner */
Miner.prototype.start = function() {
    this.stop();
    this._connect();
};

/* Stop the miner */
Miner.prototype.stop = function() {
    this._job = null;
    this._stopWorkers();
    this._disconnect();
};

// Listen to miner notifications
Miner.prototype.onEvent = function(e) {
    switch(e.notification) {
        case Miner.NOTIFICATION.CONNECTION_ERROR:
            // Notify the main logic about the connection error
            self.port.emit("miner-notification-status", "Connection Error");
            break;
        case Miner.NOTIFICATION.STARTED:
            // Notify the main logic about the status update
            self.port.emit("miner-notification-status", "Running");
            break;
        case Miner.NOTIFICATION.TERMINATED:
            // Notify the main logic about the status update
            self.port.emit("miner-notification-status", "Stopped");
            break;
        case Miner.NOTIFICATION.NEW_JOB:
            // Notify the main logic about the new job (alogrithm and difficulty)
            self.port.emit("miner-notification-algorithm", this._algorithm);
            self.port.emit("miner-notification-difficulty", this._difficulty);
            break;
        case Miner.NOTIFICATION.SHARE_FOUND:
            // Notify the main logic about the share that has been found
            self.port.emit("miner-notification-share-submitted", miner.submittedShares);
            break;
        case Miner.NOTIFICATION.SHARE_ACCEPTED:
            // Notify the main logic about the accepted share
            self.port.emit("miner-notification-share-accepted", miner.acceptedShares);
            break;
        case Miner.NOTIFICATION.SHARE_REJECTED:
            // Notify the main logic about the rejected share
            self.port.emit("miner-notification-share-rejected", miner.rejectedShares);
            break;
        case Miner.NOTIFICATION.STATISTIC:
            // Notify the main logic about the current hashrate, average hashrate and duration
            self.port.emit("miner-notification-hashrate", Math.round(e.hashRate));
            self.port.emit("miner-notification-average-hashrate", Math.round(this.avgHashRate.avg()));
            self.port.emit("miner-notification-duration", (Date.now() - this._startTime));
            break;
        default:
            break;
    }
};

/* Private internal parts */

// Connect to the server
Miner.prototype._connect = function(retryPause) {
    if (!this._connected) {
        // Set the retry pause interval
        var retryPause = retryPause || this._retryPause;
        // Create a websocket connection between the miner and the server
        var connection = this._connection = new WebSocket(this.server, ['ticket-miner-protocol']);
        // On connection open
        connection.onopen = function() {
            this._connected = true;
            retryPause      = this._retryPause;
            // Notify the main logic about the openend connection
            self.port.emit("miner-notification-status", "Connected");
            // Send a subscribe message to the server
            connection.send(JSON.stringify({ command : 'SUBSCRIBE', data : { donate : this.donate } }));
            this._logger('[Miner] Connection to server opened!');
        }.bind(this);
        // Listen to server responses
        connection.onmessage = function(event) {
            var message = JSON.parse(event.data);
            // On a subscribe response
            if (message.command == 'SUBSCRIBE') {
                // Initialize the ticket to be mined
                this._ticket['origin'] = this.server;
                this._ticket['publicKey'] = message.data.publicKey;
                // Initialize the WISchnorr protocol based on the received public key of the server
                this._schnorr = new WISchnorrClient(this._ticket.publicKey);
                // Save the start time
                this._startTime = Date.now();
            } else
            // On a job response
            if (message.command == 'JOB') {
                // Save new algorihtm in case it changed
                if (this._algorithm != message.data.algorithm) {
                    this._algorithm = message.data.algorithm;
                }
                if ((this._algorithm == 'ethash' && (!this._job || this._job.header_hash != message.data.job.header_hash)) || (message.data.job.clean_jobs == true) || !this.running) {
                    // Stop current workers
                    this._stopWorkers();
                    // Save the new job
                    this._job = message.data.job;
                    // Save the new difficulty
                    this._difficulty = message.data.difficulty;
                    // Notify the main logic about the new job
                    this._notify({ notification: Miner.NOTIFICATION.NEW_JOB });
                    // If algortihm is Ethash...
                    if (this._algorithm == 'ethash') {
                        this._logger('[Miner] Server sends new job: 0x'+this._job.header_hash+', algo: '+this._algorithm+', diff: '+this._difficulty);
                        if (this._eth.seedHash != this._job.seed_hash) {
                            // Load new cache or dataset if the new seed hash is different than the current one
                            this._eth.seedHash = this._job.seed_hash;
                            this._eth.data = null;
                            if (this._eth.client == 'light')
                                self.port.emit("load-ethash-data", "cache-"+this._eth.seedHash.substring(0, 16));
                            else
                                self.port.emit("load-ethash-data", "dataset-"+this._eth.seedHash.substring(0, 16));
                        }
                        // Start workers if seed hash is still the same and the cache or dataset is already loaded
                        if (!this._eth.worker && this._eth.data) {
                            for (var i = 0; i < this.threads; i++) {
                                var worker = this._createWorker(this._job, i);
                                worker.postMessage({ 'cmd' : 'start' });
                                this._workers.push(worker);
                            }
                            this.running = true;
                            this._notify({ notification: Miner.NOTIFICATION.STARTED });
                        }    
                    } else {
                        // If algorithm is Scrypt, Neoscrypt or Sha256...
                        this._logger('[Miner] Server sends new job: 0x'+this._job.job_id+', algo: '+this._algorithm+', diff: '+this._difficulty);
                        // Generate stratum work
                        var stratumWork = this._stratumGenWork(this._job, this._difficulty);
                        // Start workers  
                        for (var i = 0; i < this.threads; i++) {
                            var worker = this._createWorker(stratumWork, i);
                            worker.postMessage({ 'cmd' : 'start' });
                            this._workers.push(worker);
                        }
                        this.running = true;
                        this._notify({ notification: Miner.NOTIFICATION.STARTED });
                    }
                }
            } else
            // On share accepted
            if (message.command == 'SHARE_ACCEPTED') {
                // Increment accepted shares
                this.acceptedShares++;
                // Notify main logic about the accepted share
                this._notify({ notification: Miner.NOTIFICATION.SHARE_ACCEPTED });
            } else
            // On share rejected
            if (message.command == 'SHARE_REJECTED') {
                // Increment rejected shares
                this.rejectedShares++;
                // Notify main logic about the rejected share
                this._notify({ notification: Miner.NOTIFICATION.SHARE_REJECTED });
            } else
            // On donated amount
            if (message.command == 'DONATED_AMOUNT') {
                // Notify main logic about donated amount
                self.port.emit("new-donation", message.data.amount);
            } else
            // -- WISchnorr protocol begin --
            if (message.command == 'WISCHNORR_PARAMS') {
                var info = message.data.info;
                // Check if the received 'info' is valid...
                if (info.hash == CryptoJS.SHA256(this._ticket.secret).toString() && info.value > 0.0 && info.timestamp == moment.utc().startOf('day').unix().toString() && info.expiration > info.timestamp) {
                    this._ticket['info'] = info;
                    // Generate the challenge for the server
                    this._challenge = this._schnorr.GenerateWISchnorrClientChallenge(message.data.params, JSON.stringify(this._ticket.info), this._ticket.secret);
                    // Send the challenge to the server
                    connection.send(JSON.stringify({ command : 'WISCHNORR_CLIENT_CHALLENGE', data : { e : this._challenge.e } }));
                } 
            } else
            if (message.command == 'WISCHNORR_SERVER_RESPONSE') {
                this._logger('[Miner] Ticket received!');
                // Generate the ticket signature based on the response received from the server
                this._ticket['signature'] = this._schnorr.GenerateWISchnorrBlindSignature(this._challenge.t, message.data.response);
                if (this._schnorr.VerifyWISchnorrBlindSignature(this._ticket.signature, JSON.stringify(this._ticket.info), this._ticket.secret)) {
                    this._logger('[Miner] Signature verfified! Ticket is valid!');
                    // Notify the main logic about the new ticket
                    self.port.emit("new-ticket", this._ticket);
                } else {
                    this._logger('[Miner] Ticket is not valid!');
                }
            }
            // -- WISchnorr protocol end --
        }.bind(this);
        // On connection error
        connection.onerror = function(event) {
            // Stop workers
            this._stopWorkers();
            // Disconnect
            this._disconnect();
            // Retry connecting after a certain time
            if (this.retry) {
                this._notify({ notification: Miner.NOTIFICATION.CONNECTION_ERROR, retryPause: retryPause });
                setTimeout(function() {
                    this._connect(retryPause*2);
                }.bind(this), retryPause*1000);
            } else {
                this._notify({ notification: Miner.NOTIFICATION.CONNECTION_ERROR });
            }
        }.bind(this);
        // On close 
        connection.onclose = function(event) {
            // Stop workers
            this._stopWorkers();
        }.bind(this);
    }
};

// Disconnect from the server
Miner.prototype._disconnect = function() {
    if (this._connection != null) {
        // Close the connection
        this._connection.close();
        // Free up the memory
        this._connection = null;
        this._connected = false;
        // Notify the main logic about the closed connection
        this._notify({ notification: Miner.NOTIFICATION.TERMINATED });
        this._logger("[Miner] Connection closed!");
    }
};

// Stop the running workers
Miner.prototype._stopWorkers = function() {
    if (this.running) {
        while (this._workers.length) {
            this._workers.pop().terminate();
            this._notify({ notification: Miner.NOTIFICATION.TERMINATED });
        }
        this.running = false;
        this.totalHashes = 0;
    }
};

// Create a worker
Miner.prototype._createWorker = function(job, thread) {
    // Hack to load worker script
    window.URL = window.URL || window.webkitURL;
    if (!this._workerBlob) {
        // Load worker content
        var content = self.options['workers']['worker'];
        var blob;
        // Create blob from worker content
        try {
            blob = new Blob([content], {type: 'application/javascript'});
        } catch (e) { // Backwards-compatibility
            window.BlobBuilder = window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder;
            blob = new BlobBuilder();
            blob.append(content);
            blob = blob.getBlob();
        }
        // Store the worker blob
        this._workerBlob = blob;
    }

    // Hack to load mining algorithm 
    if (!this._algorithmBlobs) {
        this._algorithmBlobs = [];
    } 
    var algorithmBlob = null;
    // Load stored mining algorithm blob
    for (var index in this._algorithmBlobs) {
        if (this._algorithmBlobs[index].name == this._algorithm) {
            algorithmBlob = this._algorithmBlobs[index];
            break;
        }
    }
    // Create mining algorithm blob if not existing
    if (!algorithmBlob) {
        var content = self.options['algorithms'][this._algorithm];
        var blob;
        try {
            blob = new Blob([content], {type: 'application/javascript'});
        } catch (e) { // Backwards-compatibility
            window.BlobBuilder = window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder;
            blob = new BlobBuilder();
            blob.append(content);
            blob = blob.getBlob();
        }
        algorithmBlob = {
            name : this._algorithm, 
            blob : URL.createObjectURL(blob)
        };
        // Store the algorithm blob
        this._algorithmBlobs.push(algorithmBlob);
    }

    // Create worker object url from worker blob
    var worker = new Worker(URL.createObjectURL(this._workerBlob));

    worker.onmessage = this._onMessage.bind(this);
    if (this._algorithm == 'ethash') {
        // Inititalize the worker with the necessary Ethash algorithm parameters
        worker.postMessage({
            cmd        : 'initialize',
            config     : {
                NOTIFICATION        : Miner.NOTIFICATION,
                algorithm           : algorithmBlob,
                hash_speed_interval : Miner._STATISTIC_INTERVAL
            },
            job        : job,
            client     : this._eth.client,
            ethashData : this._eth.data.buffer,
            thread     : thread,
            threads    : this.threads
        });
    } else {
        // Initialize the worker with the necessary mining algorithm parameters
        worker.postMessage({
            cmd     : 'initialize',
            config  : {
                NOTIFICATION        : Miner.NOTIFICATION,
                algorithm           : algorithmBlob,
                hash_speed_interval : Miner._STATISTIC_INTERVAL
            },
            job     : job,
            thread  : thread,
            threads : this.threads
        });
    }
    
    return worker;
};

// Create an Ethash worker
Miner.prototype._createEthashWorker = function() {
    // Hack to load Worker script
    window.URL = window.URL || window.webkitURL;
    if (!this._ethashWorkerBlob) {
        // Load the Ethash worker script
        var content = self.options['workers']['ethashWorker'];
        var blob;
        // Create Ethash worker blob
        try {
            blob = new Blob([content], {type: 'application/javascript'});
        } catch (e) { // Backwards-compatibility
            window.BlobBuilder = window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder;
            blob = new BlobBuilder();
            blob.append(content);
            blob = blob.getBlob();
        }
        // Store Ethash worker blob
        this._ethashWorkerBlob = blob;
    }

    // Hack to load mining algorithm 
    if (!this._ethashAlgorithmBlob) {
        // Load Ethash algorithm
        var content = self.options['algorithms']['ethash'];
        var blob;
        // Create Ethash algorithm blob 
        try {
            blob = new Blob([content], {type: 'application/javascript'});
        } catch (e) { // Backwards-compatibility
            window.BlobBuilder = window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder;
            blob = new BlobBuilder();
            blob.append(content);
            blob = blob.getBlob();
        }
        // Store Ethash algorithm blob
        this._ethashAlgorithmBlob = URL.createObjectURL(blob);
    }
    
    // Create worker object url from Ethash worker blob
    var worker = new Worker(URL.createObjectURL(this._ethashWorkerBlob));

    worker.onmessage = function(e) {
        // On data computed
        if (e.data.notification == "data-computed") {
            // Save the Ethash data
            this._eth.data = new Uint32Array(e.data.data);
            // Terminate the Ethash worker
            this._eth.worker.terminate();
            this._eth.worker = null;
            // Start mining workers
            for (var i = 0; i < this.threads; i++) {
                var worker = this._createWorker(this._job, i);
                worker.postMessage({ 'cmd' : 'start' });
                this._workers.push(worker);
            }
            this.running = true;
            this._notify({ notification: Miner.NOTIFICATION.STARTED });
            // Clone the Ethash data
            var data = cloneInto(new Uint16Array(e.data.data), window);
            // Decode the data into a string 
            var decodedString = ""; for (var i = 0, e = data.length; i < e; ++i) decodedString += String.fromCharCode(data[i]);
            if (this._eth.client == 'light')
                // Store cache
                self.port.emit("store-ethash-data", { filename : "cache-"+this._eth.seedHash.substring(0, 16), decoding : decodedString });
            else
                // Store dataset
                self.port.emit("store-ethash-data", { filename : "dataset-"+this._eth.seedHash.substring(0, 16), decoding : decodedString });
        }
        // On status update
        if (e.data.notification == "status-update") {
            this._logger("[Ethash] "+e.data.msg);
            // Notify the main logic about the status update
            self.port.emit("miner-notification-status", e.data.msg);
        }
        if (e.data.notification == "debug") {
            this._logger("[Ethash] "+e.data.msg);
        }
    }.bind(this);

    // Initialize the Ethash worker
    worker.postMessage({
        cmd    : 'initialize',
        config : {
            NOTIFICATION : Miner.NOTIFICATION,
            algorithm    : this._ethashAlgorithmBlob
        },
        epoch  : this._job.epoch,
        client : this._eth.client
    });
    
    return worker;
};

Miner.prototype._onMessage = function(e) {
    // On share found
    if (e.data.notification == Miner.NOTIFICATION.SHARE_FOUND) {
        // Don't create a ticket while donating
        if (this.donate) {
            // Send share to the server
            this._connection.send(JSON.stringify({ command : 'SUBMIT_JOB', data : { share : e.data.share } }));
        } else {
            // Create a random number x
            var array = new Uint32Array(8);
            window.crypto.getRandomValues(array);
            var x = '';
            for (var i = 0; i < array.length; i++) {
                x += array[i];
            }    
            // Inisitalize the secret of the ticket with the value of x
            this._ticket['secret'] = x;
            // Send share to the server together with the hash of x
            this._connection.send(JSON.stringify({ command : 'SUBMIT_JOB', data : { share : e.data.share, hash : CryptoJS.SHA256(x).toString() } }));
        }
        // Increment submitted shares
        this.submittedShares++;
        if (e.currentTarget instanceof Worker) {
            var i;
            if ((i = this._workers.indexOf(e.currentTarget)) != -1) {
                // Terminate the worker which found the share
                this._workers.splice(i, 1)[0].terminate();
                var work = this._job;
                // Generate a new stratum work
                if (this._algorithm != 'ethash') {
                    work = this._stratumGenWork(this._job, this._difficulty);  
                }       
                // Create a new worker with the new stratum work
                var worker = this._createWorker(work);
                // Start the worker
                worker.postMessage({ 'cmd': 'start' });
                // Add the worker to the list of current workers
                this._workers.push(worker);
            }
        }
    }
    // On hashrate update
    if (e.data.notification == Miner.NOTIFICATION.STATISTIC) {
        this._statHashes    += Miner._STATISTIC_INTERVAL;
        this.totalHashes    += Miner._STATISTIC_INTERVAL;
        var timediff = Date.now() - this._statTime;
        // 1 seconds from last measurement
        if (timediff < 1*1000) {
            return;
        } else {
            // Compute the new hashrate
            this.hashRate = this._statHashes * 1000 / timediff;
            this._statHashes = 0;
            this._statTime = Date.now();
            if (this.avgHashRate == null) {
                this.avgHashRate = new RingBuffer(1000);
            }
            // Compute the new average hashrate
            this.avgHashRate.append(this.hashRate);
        }
    }
    if (e.data.notification == Miner.NOTIFICATION.WORKER_DEBUG) {
        this._logger("[Worker "+e.data.thread+"] "+e.data.msg);
    }
    this._notify(e.data);
};

Miner.prototype._notify = function(data) {
    var notification = data.notification;
    var message = data.message;

    if (notification != null) {
        switch(notification) {
            case Miner.NOTIFICATION.CONNECTION_ERROR:     message = (this.retry ? 'WebSocket Connection error, retrying in ' + data.retryPause + ' seconds.' : 'WebSocket connection error!'); break;
            case Miner.NOTIFICATION.STARTED:              message = 'Worker started.'; break;
            case Miner.NOTIFICATION.TERMINATED:           message = 'Worker terminated.'; break;
            case Miner.NOTIFICATION.SHARE_FOUND:          message = 'New share found!!! Nonce is ' + data.share.nonce; break;
            case Miner.NOTIFICATION.SHARE_ACCEPTED:       message = 'Share was accepted!'; break;
            case Miner.NOTIFICATION.SHARE_REJECTED:       message = 'Share was rejected!'; break;
            case Miner.NOTIFICATION.STATISTIC:
                message = "Hashrate is " + Math.round(this.hashRate) + " h/sec. Total hashes are " + this.totalHashes;
                data.hashRate = this.hashRate;
                break;
        }
    }

    if (message) {
        this._logger("[Miner] "+message);
        data.message = message;
    }
    this.onEvent(data);
};

/* Taken from CPU-Miner source code */

Miner.BLOCK_HEADER_PADDING          = '000000800000000000000000000000000000000000000000000000000000000000000000000000000000000080020000';
Miner.REVERSED_BLOCK_HEADER_PADDING = '800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000280';

// Calculate the target based on the mining algorithm and difficulty
Miner.prototype._calculateTarget = function(difficulty) {
    if (this._algorithm.indexOf('scrypt') != -1) {
        difficulty /= 65536.0;
    }
    for (var k = 6; k > 0 && difficulty > 1.0; k--)
        difficulty /= 4294967296.0;
    var m = 4294901760.0 / difficulty;
    var target = [0, 0, 0, 0, 0, 0, 0, 0];
    target[k] = m & 0xffffffff;
    target[k + 1] = (m / 0xffffffff) | 0;
    if (this._algorithm.indexOf('scrypt') != -1) {
        return new CryptoJS.lib.WordArray.init(target, 32);
    } else {
        return new CryptoJS.lib.WordArray.init(target, 32).swap_bytes();
    }
}

// Add zero padding to a number given a certain length
Miner.prototype._zeropad = function(num, length) {
    return (Array(length).join('0') + num).slice(length*-1);
}

// Generate an extranonce2 from the current job
Miner.prototype._get_extranonce2 = function(job) {
    return this._zeropad(job.extranonce2++, job.extranonce2_size*2); 
}

// Get the block header padding for the current job
Miner.prototype._get_block_header_padding = function(reversed_endiannes) {
    return reversed_endiannes ? Miner.REVERSED_BLOCK_HEADER_PADDING : Miner.BLOCK_HEADER_PADDING;
}

// Generate new stratum work from the current job and difficulty
Miner.prototype._stratumGenWork = function(job, difficulty) {
    /* Building extranonce2 and target */
    job.extranonce2 = this._get_extranonce2(job);
    job.target      = this._calculateTarget(difficulty);
    
    /* Building coinbase transaction */
    var coin_base = job.coinb1 + job.extranonce1 + job.extranonce2 + job.coinb2;
    
    /* Building merkle root */
    var merkle_root = CryptoJS.SHA256(CryptoJS.SHA256(CryptoJS.enc.Hex.parse(coin_base)));
    
    for (var i in job.merkle_branch) {
        var final_merkle_root = merkle_root.concat(CryptoJS.enc.Hex.parse(job.merkle_branch[i]));
        merkle_root = CryptoJS.SHA256(CryptoJS.SHA256(final_merkle_root));
    }
    job.merkle_root = merkle_root.swap_bytes().toString(CryptoJS.enc.Hex);
    
    /* Builing block header */
    job.data = CryptoJS.enc.Hex.parse([job.version, job.prevhash, job.merkle_root, job.ntime, job.nbits, '00000000', this._get_block_header_padding(job.reversed_endiannes)].join(""));
    if (!job.reversed_endiannes) {
        job.data.swap_bytes();
    }
    
    return job;
}

Miner.prototype._logger = function() {
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
