var o = {
    b: 1
}

var a = new Function('o', 'console.log(o)');


a.apply(function (){}, [o])