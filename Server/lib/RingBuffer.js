/** 
  -- RingBuffer.js -- 
  Author : Christof Torres <christof.ferreira.001@student.uni.lu>
  Date   : June 2016
**/

/* Initializes the RingBuffer with a maximum size */
function RingBuffer(maxSize) {
    var data    = [];
    var cursor  = 0;
    var isFull  = false;
    // Adds a new item to the RingBuffer if not full, else it overwrites an exisitng item with the new item
    this.append = function(x) {
        if (isFull) {
            data[cursor] = x;
            cursor = (cursor + 1) % maxSize;
        } else {
            data.push(x);
            cursor++;
            if (data.length === maxSize) {
                cursor = 0;
                isFull = true;
            }
        }
    };
    // Computes the average of the items contained inside the RingBuffer
    this.avg = function() {
        if (data.length === 0) return 0.0;
        var sum = data.reduce(function(a, b) { return a + b });
        return sum / (isFull ? maxSize : cursor);
    };
    // Returns the current size of the RingBuffer
    this.size = function() {
        return isFull ? maxSize : cursor;
    };
    // Removes all the items contained inside the RingBuffer
    this.clear = function() {
        data   = [];
        cursor = 0;
        isFull = false;
    };
}

module.exports = RingBuffer;
