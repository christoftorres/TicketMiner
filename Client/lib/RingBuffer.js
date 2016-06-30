/** 
  -- RingBuffer.js -- 
  Author : Christof Torres <christof.ferreira.001@student.uni.lu>
  Date   : June 2016
**/

/* Initializes the RingBuffer with a maximum size */
function RingBuffer(maxSize) {
    this.maxSize = maxSize;
    this.data    = [];
    this.cursor  = 0;
    this.isFull  = false;
}

/* Adds a new item to the RingBuffer if not full, else it overwrites an exisitng item with the new item */
RingBuffer.prototype.append = function(x) {
    if (this.isFull) {
        this.data[this.cursor] = x;
        this.cursor = (this.cursor + 1) % this.maxSize;
    } else {
        this.data.push(x);
        this.cursor++;
        if (this.data.length === this.maxSize) {
            this.cursor = 0;
            this.isFull = true;
        }
    }
};

/* Computes the average of the items contained in the RingBuffer */
RingBuffer.prototype.avg = function() {
    if (data.length === 0) return 0.0;
    var sum = this.data.reduce(function(a, b) { return a + b });
    return sum / (this.isFull ? this.maxSize : this.cursor);
};

/* Returns the current size of the RingBuffer */
RingBuffer.prototype.size = function() {
    return this.isFull ? this.maxSize : this.cursor;
};

/* Clears the items contained in the RingBuffer */
RingBuffer.prototype.clear = function() {
    this.maxSize = 0;
    this.data    = [];
    this.cursor  = 0;
    this.isFull  = false;
};
