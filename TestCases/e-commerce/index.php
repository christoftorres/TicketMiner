<?php 
    header("X-TicketMiner-Service: wss://localhost:8443");
?>  
<!DOCTYPE html>
<html lang="en">

<head>

    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="">
    <meta name="author" content="">

    <title>E-commerce Test Page</title>

    <!-- Bootstrap Core CSS -->
    <link href="css/bootstrap.min.css" rel="stylesheet">

    <!-- Custom CSS -->
    <link href="css/heroic-features.css" rel="stylesheet">

    <!-- HTML5 Shim and Respond.js IE8 support of HTML5 elements and media queries -->
    <!-- WARNING: Respond.js doesn't work if you view the page via file:// -->
    <!--[if lt IE 9]>
        <script src="https://oss.maxcdn.com/libs/html5shiv/3.7.0/html5shiv.js"></script>
        <script src="https://oss.maxcdn.com/libs/respond.js/1.4.2/respond.min.js"></script>
    <![endif]-->

    <script type="text/javascript" charset="utf-8">
        function PayByTicket(itemID) {
            var event = document.createEvent('CustomEvent');
            event.initCustomEvent("pay-by-ticket-request", true, true, { origin: window.location.hostname, itemID: JSON.stringify(itemID) });
            document.documentElement.dispatchEvent(event);
        }
    </script>

</head>

<body>

    <!-- Navigation -->
    <nav class="navbar navbar-inverse navbar-fixed-top" role="navigation">
        <div class="container">
            <!-- Brand and toggle get grouped for better mobile display -->
            <div class="navbar-header">
                <button type="button" class="navbar-toggle" data-toggle="collapse" data-target="#bs-example-navbar-collapse-1">
                    <span class="sr-only">Toggle navigation</span>
                    <span class="icon-bar"></span>
                    <span class="icon-bar"></span>
                    <span class="icon-bar"></span>
                </button>
                <a class="navbar-brand" href="#">E-commerce</a>
            </div>
            <!-- Collect the nav links, forms, and other content for toggling -->
            <div class="collapse navbar-collapse" id="bs-example-navbar-collapse-1">
                <ul class="nav navbar-nav">
                    <li>
                        <a href="#">About</a>
                    </li>
                    <li>
                        <a href="#">Services</a>
                    </li>
                    <li>
                        <a href="#">Contact</a>
                    </li>
                </ul>
            </div>
            <!-- /.navbar-collapse -->
        </div>
        <!-- /.container -->
    </nav>

    <!-- Page Content -->
    <div class="container">

        <!-- Jumbotron Header -->
        <header class="jumbotron hero-spacer">
            <h1>Welcome!</h1>
            <p>This is a very simple and basic e-commerce website with the only purpose of demonstrating how payments and downloads of e-commerce items can easily be achieved through the TicketMiner browser add-on.</p>
        </header>

        <hr>

        <!-- Title -->
        <div class="row">
            <div class="col-lg-12">
                <h3>Latest Items</h3>
            </div>
        </div>
        <!-- /.row -->

        <!-- Page Features -->
        <div class="row text-center">

            <div class="col-md-3 col-sm-6 hero-feature">
                <div class="thumbnail">
                    <img src="images/decoration.png" alt="">
                    <div class="caption">
                        <h3>Colorful Wallpaper</h3>
                        <p>A decorative background wallpaper with colorful waves and bubbles.</p>
                        <p><b>Price:</b> 0.05 EUR</p>
                        <p>
                            <button class="btn btn-primary" onclick="PayByTicket(100)">Buy Now!</button> <button class="btn btn-default">More Info</button>
                        </p>
                    </div>
                </div>
            </div>

            <div class="col-md-3 col-sm-6 hero-feature">
                <div class="thumbnail">
                    <img src="images/heart.png" alt="">
                    <div class="caption">
                        <h3>Heart of Stone</h3>
                        <p>A picture of stones with a stone in the center shapped like a heart.</p>
                        <p><b>Price:</b> 0.02 EUR</p>
                        <p>
                            <button class="btn btn-primary" onclick="PayByTicket(101)">Buy Now!</button> <button class="btn btn-default">More Info</button>
                        </p>
                    </div>
                </div>
            </div>

            <div class="col-md-3 col-sm-6 hero-feature">
                <div class="thumbnail">
                    <img src="images/football.png" alt="">
                    <div class="caption">
                        <h3>Euro 2016 Football</h3>
                        <p>A picture of a Euro 2016 football laying at the corner of a football field.</p>
                        <p><b>Price:</b> 0.03 EUR</p>
                        <p>
                            <button class="btn btn-primary" onclick="PayByTicket(102)">Buy Now!</button> <button class="btn btn-default">More Info</button>
                        </p>
                    </div>
                </div>
            </div>

            <div class="col-md-3 col-sm-6 hero-feature">
                <div class="thumbnail">
                    <img src="images/seven_sisters.png" alt="">
                    <div class="caption">
                        <h3>Seven Sisters</h3>
                        <p>A picture taken by Diego Torres at the Seven Sisters reefs in England.</p>
                        <p><b>Price:</b> 0.10 EUR</p>
                        <p>
                            <button class="btn btn-primary" onclick="PayByTicket(103)">Buy Now!</button> <button class="btn btn-default">More Info</button>
                        </p>
                    </div>
                </div>
            </div>

        </div>
        <!-- /.row -->

        <hr>

        <!-- Footer -->
        <footer>
            <div class="row">
                <div class="col-lg-12">
                    <p>Copyright &copy; Christof Torres 2016 - All images are from Pixabay and are released free of copyrights under Creative Commons CC0.</p>
                </div>
            </div>
        </footer>

    </div>
    <!-- /.container -->

    <!-- jQuery -->
    <script src="js/jquery.js"></script>

    <!-- Bootstrap Core JavaScript -->
    <script src="js/bootstrap.min.js"></script>

</body>

</html>
