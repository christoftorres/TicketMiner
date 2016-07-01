#TicketMiner Test Cases
Copyright (C) 2016 - Christof Torres, University of Luxembourg

License/usage:
=========================
This software is released under the terms of the MIT license, a copy
of which should be included with this distribution.
This software is provided "AS IS", without any warranties of any kind,
either expressed or implied.

About
=========================
Two different test cases are provided:

1. Donations
2. E-commerce

Donations
---------

This test case illustrates how the TicketMiner service could easily provide a new way of donating money to websites such as Wikipedia. This test case includes therefore the four official Wikipedia donation dialogs as of 2015 and 2016 [Fundraising ideas](https://meta.wikimedia.org/wiki/Fundraising/2015-16_Fundraising_ideas), slightly addapted to accept TicketMiner donations. The four official Wikipedia donation dialogs are:

* Large coffee
* Large lightbulb
* Small blue
* Small coffee

E-commerce
----------

This test case illustrates how the TicketMiner service could easily be used for micro-payments on e-commerce websites. The test case website permits a user to choose and buy four different pictures online. By clicking on the "Buy now!" button, the user will initialize the payment process by submitting his mined tickets to the server, and on success, the watermark-free and full resolution picture will be downloaded from the e-commerce website to the local downloads directory on the user's computer.

Installation instructions
=========================

Simply copy both test case directories, namely "donations" and "e-commerce" to a webserver such as Apache and set the advertising HTTP header "X-TicketMiner-Service" contained inside the index.php files to the address where your TicketMiner Server is running currently.

