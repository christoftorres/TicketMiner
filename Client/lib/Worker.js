/** 
  -- Worker.js -- 
  Author : Christof Torres <christof.ferreira.001@student.uni.lu>
  Date   : June 2016
**/

// Config object
window    = {};
var  c    = {};
self.c    = c;
self.init = false;

self.onmessage = function(e) {
    var cmd = e.data.cmd;
            
    switch(cmd) {
        case 'initialize':
            c = e.data.config;
            // Set the job
            self.job = e.data.job;
            // Set the worker id
            self.thread = e.data.thread;
            // Set the number of concurent workers
            self.threads = e.data.threads;
            if (c.algorithm.name == 'ethash') {
                // Set the Ethash client type
                self.client = e.data.client;
                // Set the Ethash data
                self.ethashData = new Uint32Array(e.data.ethashData);
            }
            // Import the mining algorithm
            importScripts(c.algorithm.blob);
            debug("Algorithm '"+c.algorithm.name+"' was imported!");
            self.init = true;
            break;
        case 'start':
            if (self.init) {
                // Start the worker instance
                debug("Started working...");
                run();
            } else {
                debug("Not initialized...");
            }
            break;
        default:
            debug("Unkown command: "+cmd);
            break;
    }
};

// Run the thread and notify the miner
function run() {
    self.postMessage({ 
        'notification' : c.NOTIFICATION.STARTED 
    });
    doWork();
}

// Notify the miner about the current hashrate
function hash_speed_update() {
    self.postMessage({
        'notification' : c.NOTIFICATION.STATISTIC,
        'workerHashes' : self.hashes
    });
}

// Send a debug message to the miner
function debug(msg) {        
    self.postMessage({ 
        'notification' : c.NOTIFICATION.WORKER_DEBUG, 
        'thread' : self.thread,
        'msg' : msg 
    });                                                                          
}

// Mine based on hashing different random nonces until the hash is smaller or matches a given target
function doWork() {
    if (c.algorithm.name == 'ethash') {
        // Create an Ethash instance
        var ethash  = new Ethash();
        // Initialize the nonce
        var nonce   = new Uint32Array(2);
        //var nonce = hexStringToBytes("ff4136b6b6a244ec");
        //var nonce = hexStringToBytes("e360b6170c229d15");
        // Initialize the number of hashes
        self.hashes = 0;
        while (true) {
            //debug('nonce: '+bytesToHexString(new Uint8Array(nonce.buffer)));
            var result = null;
            if (client == 'light')
                // Hash the nonce with the header using the hashimoto light algorithm
                result = ethash.hashimotoLight(parseInt(self.job.epoch), self.job.header_hash, nonce, self.ethashData);
            else
                // Hash the nonce with the header using the hashimoto large algorithm
                result = ethash.hashimotoFull(parseInt(self.job.epoch), self.job.header_hash, nonce, self.ethashData);
            //debug('hash: '+result.hash);
            // Increment the number of hashes
            self.hashes++;
            // Check if the hash is smaller or equal to the given target
            if (result.hash <= self.job.target) {
                break;
            }
            // Update the hash speed
            if (self.hashes % c.hash_speed_interval == 0) {
                hash_speed_update();
            }
            // Increment the nonce
            if (nonce[0] == 0xFFFFFFFF) {
                nonce[0] = 0;
                if (nonce[1] == 0xFFFFFFFF)
                    nonce[1] = 0;   
                else 
                    nonce[1]++;
            } else
                nonce[0]++; 
        }
        // Send the share we found to the miner
        self.postMessage({
            'notification' : c.NOTIFICATION.SHARE_FOUND,
            'share' : {
                header_hash : self.job.header_hash,
                mixHash     : result.cmix,
                nonce       : bytesToHexString(new Uint8Array(nonce.buffer))
            }
        });
    } else
    if (c.algorithm.name == 'sha256') {
        // Load the first 80 bytes of the header 
        var data    = SHA256.wordsToBytes(self.job.data.words).slice(0, 80);
        // Load the target
        var target  = SHA256.wordsToBytes(self.job.target.words);
        // Initialize the nonce
        var nonce   = (Math.pow(2, 32) / self.threads) * self.thread;
        // Initialize the number of hashes
        self.hashes = 0;
        while (true) {
            // Load the 32 bit nonce into the last 4 bytes of the data
            var nonce_bytes = SHA256.Int32ToBytes(nonce);
            data[76] = nonce_bytes[3];
            data[77] = nonce_bytes[2];
            data[78] = nonce_bytes[1];
            data[79] = nonce_bytes[0];
            // Hash the data twice (sha256d)
            var hash = SHA256.digest(SHA256.digest(data));
            // Increment the number of hashes
            self.hashes++;
            var nonce_found = true;
            // Check if the nonce is smaller or equal to the given target
            for (var i = hash.length-1; i >= 0; i--) {
                if (hash[i] > target[i]) {
                    nonce_found = false;
                    break;
                } else 
                if (hash[i] < target[i])
                    break;
            }
            if (nonce_found) {
                break;
            }
            // Update the hash speed
            if (self.hashes % c.hash_speed_interval == 0) {
                hash_speed_update();
            }
            // Increment the nonce
            if (nonce == 0xFFFFFFFF)
                nonce = 0;
            else
                nonce++;
        }
        // Send the share we found to the miner
        self.postMessage({
            'notification' : c.NOTIFICATION.SHARE_FOUND,
            'share' : {
                job_id      : self.job.job_id,
                extranonce2 : self.job.extranonce2,
                ntime       : self.job.ntime,
                nonce       : nonce
            }
        });
    } else {    
        // Load the header
        var uData = new Uint8Array(new Uint32Array(self.job.data.words).buffer);
        // Load the target
        var uTarget = new Uint8Array(new Uint32Array(self.job.target.words).buffer);
        // Wrap the number and type of arguments to the scanhash method 
        var scanhash = window.Module.cwrap('scanhash', 'number', ['array', 'array', 'number', 'string', 'number']);
        // Allocate 4 bytes (32 bit) for the nonce
        var nonce_pointer = window.Module._malloc(4);
        // Initialize the nonce
        window.Module.setValue(nonce_pointer, (Math.pow(2, 32) / self.threads) * self.thread, 'i32');
        // Run the scanhash method with the header, target and nonce
        var result = scanhash(uData, uTarget, nonce_pointer, 'hash_speed_update()', c.hash_speed_interval);
        // We found a hash smaller or equal to the target if the result is greater than zero
        if (result > 0) {
            // Get the nonce
            var nonce = window.Module.getValue(nonce_pointer, 'i32');
            // Send the share we found to the miner
            self.postMessage({
                'notification' : c.NOTIFICATION.SHARE_FOUND,
                'share' : {
                    job_id      : self.job.job_id,
                    extranonce2 : self.job.extranonce2,
                    ntime       : self.job.ntime,
                    nonce       : nonce
                }
            });
        }
    }
}
