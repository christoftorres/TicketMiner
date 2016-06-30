/** 
  -- index.js -- 
  Author : Christof Torres <christof.ferreira.001@student.uni.lu>
  Date   : June 2016
**/

// This file acts as mediator between the add-on's main logic (main.js) and the UI. 
// Communication with the UI is achieved through "postMessage" calls, 
// whereas the communication with the main logic is achieved through "port" object calls.


// -- Communication from the main logic to the UI --

self.port.on("show-menu", function(data) {
	window.postMessage(JSON.stringify({ command : 'show-menu', data : data }), "*");
});

self.port.on("show-miner", function(data) {
	window.postMessage(JSON.stringify({ command : 'show-miner', data : data }), "*");
});

self.port.on("donation-request", function(data) {
	window.postMessage(JSON.stringify({ command : 'donation-request', data : data }), "*");
});

self.port.on("purchase-request", function(data) {
	window.postMessage(JSON.stringify({ command : 'purchase-request', data : data }), "*");
});

self.port.on("new-job", function(job) {
	window.postMessage(JSON.stringify({ command : 'new-job', data : job }), "*");
});

self.port.on("miner-notification-status", function(notification) {
	window.postMessage(JSON.stringify({ command : 'miner-notification-status', data : notification }), "*");	
});

self.port.on("miner-notification-algorithm", function(notification) {
	window.postMessage(JSON.stringify({ command : 'miner-notification-algorithm', data : notification }), "*");	
});

self.port.on("miner-notification-difficulty", function(notification) {
	window.postMessage(JSON.stringify({ command : 'miner-notification-difficulty', data : notification }), "*");	
});

self.port.on("miner-notification-hashrate", function(notification) {
	window.postMessage(JSON.stringify({ command : 'miner-notification-hashrate', data : notification }), "*");	
});

self.port.on("miner-notification-average-hashrate", function(notification) {
	window.postMessage(JSON.stringify({ command : 'miner-notification-average-hashrate', data : notification }), "*");	
});

self.port.on("miner-notification-duration", function(notification) {
	window.postMessage(JSON.stringify({ command : 'miner-notification-duration', data : notification }), "*");	
});

self.port.on("miner-notification-share-submitted", function(notification) {
	window.postMessage(JSON.stringify({ command : 'miner-notification-share-submitted', data : notification }), "*");	
});

self.port.on("miner-notification-share-accepted", function(notification) {
	window.postMessage(JSON.stringify({ command : 'miner-notification-share-accepted', data : notification }), "*");	
});

self.port.on("miner-notification-share-rejected", function(notification) {
	window.postMessage(JSON.stringify({ command : 'miner-notification-share-rejected', data : notification }), "*");	
});

self.port.on("miner-notification-amount", function(notification) {
	window.postMessage(JSON.stringify({ command : 'miner-notification-amount', data : notification }), "*");	
});

self.port.on("new-ticket", function(ticket) {
	window.postMessage(JSON.stringify({ command : 'new-ticket', data : ticket }), "*");
});

self.port.on("remove-tickets", function(tickets) {
	window.postMessage(JSON.stringify({ command : 'remove-tickets', data : tickets }), "*");
});


// -- Communication from the UI to the main logic --

window.addEventListener("message", function(event) {
	var message = JSON.parse(event.data);
 	if (message.command == 'donation-response') {
 		self.port.emit("donation-response", message.data);
 	} else
 	if (message.command == 'purchase-response') {
 		self.port.emit("purchase-response", message.data);
 	} else
 	if (message.command == 'start-miner') {
 		self.port.emit("start-miner", message.data);
 	} else
 	if (message.command == 'start-mining-job') {
 		self.port.emit("start-mining-job", message.data);
 	} else
 	if (message.command == 'stop-mining-job') {
 		self.port.emit("stop-mining-job", message.data);
 	} else
 	if (message.command == 'delete-mining-job') {
 		self.port.emit("delete-mining-job", message.data);
 	} else
 	if (message.command == 'delete-ticket') {
 		self.port.emit("delete-ticket", message.data);
 	} else
 	if (message.command == 'update-preferences') {
 		self.port.emit("update-preferences", message.data);
 	} else
 	if (message.command == 'delete-storage') {
 		self.port.emit("delete-storage", message.data);
 	} else
 	if (message.command == 'change-panel-size') {
	 	self.port.emit("change-panel-size", message.data);
	}
}, false);
