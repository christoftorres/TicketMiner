/** 
  -- VariableDifficulty.js -- 
  Author : Christof Torres <christof.ferreira.001@student.uni.lu>
  Date   : June 2016
**/

// VarDiff is partially ported from node-stratum-pool by zone117x
// https://github.com/zone117x/node-stratum-pool/blob/master/lib/varDiff.js

var RingBuffer = require('./RingBuffer');

// Truncate a number to a fixed amount of decimal places
function toFixed(num, len) {
    return parseFloat(num.toFixed(len));
}

// Initialize the variable difficulty algorithm
function VariableDifficulty(options) {
    this._options    = options;

    // Compute the variance
    this._variance   = options.targetTime * (options.variancePercent / 100);
    // Compute the buffersize
    this._bufferSize = options.retargetTime / options.targetTime * 4;
    // Compute the target minimum time
    this._tMin       = options.targetTime - this._variance;
    // Compute the target maximum time
    this._tMax       = options.targetTime + this._variance;

    this.lastTs; this.lastRtc; this.timeBuffer;
}

// Compute the new difficulty based on the current difficulty
VariableDifficulty.prototype.computeNewDifficulty = function(current_difficulty) {
       
    // Get the current time in seconds
    var ts = (Date.now() / 1000) | 0;
    
    // Return current difficulty if there hasn't happened a retarget until now
    if (!this.lastRtc) {
        this.lastRtc    = ts - this._options.retargetTime / 2;
        this.lastTs     = ts;
        this.timeBuffer = new RingBuffer(this._bufferSize);
        return current_difficulty;
    }

    // Get the time difference since the last computation
    var sinceLast = ts - this.lastTs;

    // Add the time difference to the buffer
    this.timeBuffer.append(sinceLast);
    this.lastTs = ts;

    // Return the current difficulty if the difference of the between the current time and the last retarget is below the retarget time
    if ((ts - this.lastRtc) < this._options.retargetTime && this.timeBuffer.size() > 0)
        return current_difficulty;

    // Do a retarget
    this.lastRtc = ts;
    // Compute the average time of the added time differences
    var avg = this.timeBuffer.avg();
    // Compute the delta difficulty factor based on the target time and the average time
    var ddiff = this._options.targetTime / avg;

    // If the average time is larger than the target maximum time and the current difficulty is larger or equal to the minimum difficulty
    if (avg > this._tMax && current_difficulty >= this._options.minDiff) {
        // If the current difficulty is equal to the minimum difficulty
        if (current_difficulty == this._options.minDiff) {
            // Increase the delta difficulty factor
            ddiff = this._options.maxDiff * ddiff * current_difficulty
        } else
        // If the current delta difficulty factor is smaller than the minimum difficulty
        if (ddiff * current_difficulty < this._options.minDiff) {
            // Set the minimum difficulty as the delta difficulty factor
            ddiff = this._options.minDiff / current_difficulty;
        }
    // If the average time is smaller than the target minimum time
    } else if (avg < this._tMin) {
        // If the current delta difficulty factor is larger than the maximum difficulty
        if (ddiff * current_difficulty > this._options.maxDiff) {
            // Set the maximum difficulty as the delta difficulty factor
            ddiff = this._options.maxDiff / current_difficulty;
        }
    }
    else{
        return current_difficulty;
    }

    // Compute the new difficulty based on the current difficulty and the delta difficulty factor
    var newDiff = Math.ceil(toFixed(current_difficulty * ddiff, 8));
    // Clear the buffer
    this.timeBuffer.clear();
    
    // Return the new difficulty
    return newDiff;
};

module.exports = VariableDifficulty;
