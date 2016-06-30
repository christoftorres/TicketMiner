/** 
  -- request.js -- 
  Author : Christof Torres <christof.ferreira.001@student.uni.lu>
  Date   : June 2016
**/

// Listen to donation request events coming from websites and forward them to the add-on's main logic
window.addEventListener("donate-by-ticket-request", function(event) {
  self.port.emit("donate-by-ticket-request", JSON.stringify(event.detail));
}, false);

// Listen to purchase request events coming from websites and forward them to the add-on's main logic
window.addEventListener("pay-by-ticket-request", function(event) {
  self.port.emit("pay-by-ticket-request", JSON.stringify(event.detail));
}, false);
