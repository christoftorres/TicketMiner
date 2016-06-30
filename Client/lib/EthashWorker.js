/** 
  -- EthashWorker.js -- 
  Author : Christof Torres <christof.ferreira.001@student.uni.lu>
  Date   : June 2016
**/

// Config object
var  c    = {};
self.c    = c;
self.init = false;

self.onmessage = function(e) {
    var cmd = e.data.cmd;
            
    switch(cmd) {
        case 'initialize':
            c = e.data.config;
            // Set the epoch
            self.epoch = e.data.epoch;
            // Set the client type
            self.client = e.data.client;
            // Load the Ethash algorithm
            importScripts(c.algorithm);
            debug("Initialized...");
            self.init = true;
            break;
        case 'start':
            if (self.init) {
                // Start the worker instance
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

function run() {
    // Create an Ethash instance
    var ethash = new Ethash();
    if (self.client == 'light') {
        // Compute the Ethash cache for the given epoch
        var cacheObject = ethash.computeCache(self.epoch);
        // Send the cache back to the miner
        self.postMessage({ 
            'notification' : 'data-computed', 
            'data'         : cacheObject.cache.buffer
        }, [cacheObject.cache.buffer]);
    } else {
        // Compute the Ethash cache for the given epoch
        var cacheObject = ethash.computeCache(self.epoch);
        // Compute the Ethash DAG based on the computed cache for the given epoch
        var DAGObject   = ethash.computeDAG(self.epoch, cacheObject.cacheSize, cacheObject.cache);
        // Send the dataset back to the miner
        self.postMessage({ 
            'notification' : 'data-computed', 
            'data'      : DAGObject.dataset.buffer
        }, [DAGObject.dataset.buffer]);
    }
}

// Send a status update to the miner     
function updateStatus(msg) {   
    self.postMessage({ 
        'notification' : 'status-update', 
        'msg' : msg 
    });                                                                          
}

// Send a debug message to the miner
function debug(msg) {        
    self.postMessage({ 
        'notification' : 'debug', 
        'msg' : msg 
    });                                                                          
}
