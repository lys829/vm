(function (){
    var Registry = {} //将函数曝光到此对象上，方便访问器收集依赖
    var prefix = 'zx-';
    var expose = Date.now(); //命名私有前缀
    var subscribers = 'zx-' + expose;
    var stopRepeatAssign = false;
    function noop(){};


    var isEqual = Object.is || function(v1, v2) {
        if (v1 === 0 && v2 === 0) {
            return 1 / v1 === 1 / v2
        } else if (v1 !== v1) {
            return v2 !== v2
        } else {
            return v1 === v2;
        }
    }

    function generateID() {
        return "aaron" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    }


    //MVVM 类
    MVVM = function (){};

    var VMODELS = MVVM.vmodels = {};

    MVVM.define = function (name, factory){
        var scope = {};

        //scope 收集外部定义的属性和方法
        factory(scope);

        //生成 vm对象(setter, getter)
        var model = modelFactory(scope);

        //改变函数引用变成转化后vm对象,而不是scope对象
        model.$id = name;
        return VMODELS[name] = model;
    }

    /**
     * 生成VM
     * @param scope
     * @returns vModel
     * */

    function modelFactory(scope){
        var vModel = {}; //真正视图模型对象
        var originalModel = {}; //原始模型数据

        var accessingProperties = {};   //监控属性 转化成set get控制器
        var normalProperties = {};  //普通属性

        for(var key in scope){
            resolveAccess(key, scope[key], originalModel, normalProperties, accessingProperties);
        }

        //VM对象
        vModel = Object.defineProperties(vModel, withValue(accessingProperties));

        //没有转化的函数(方法)
        for(var key in normalProperties) {
            vModel[key] = normalProperties[key]
        }

        vModel.$id = generateID();
        vModel.$accessors = accessingProperties;
        vModel.$originalModel = originalModel;
        vModel[subscribers] = [];
        return vModel;
    }


    //收集依赖于这个访问器的订阅者
    function collectSubscribers(accessor) {
        if (Registry[expose]) { //只有当注册了才收集
            var list = accessor[subscribers]
            list && ensure(list, Registry[expose]) //只有数组不存在此元素才push进去
        }
    }

    function ensure(target, item) {
        //只有当前数组不存在此元素时只添加它
        if (target.indexOf(item) === -1) {
            target.push(item)
        }
        return target;
    }

    /*
    *
    * */
    function withValue(props) {
        var descriptors = {};
        for(var i in props) {
            descriptors[i] = {
                set: props[i],
                get: props[i],
                enumerable: true,
                configurable: true
            }
        }
        return descriptors;
    }

    //配合 modelFactory使用
    function resolveAccess(key, value, originalModel, normalProperties, accessingProperties){
        originalModel[key] = value; //缓存原始值

        var valueType = $.type(value);
        //如果是函数(方法),不用监控
        if(valueType === 'function'){
            return normalProperties[key] = value;
        }

        var accessor, oldArgs;
        if(valueType === 'number') {  //暂时只针对number类型处理
            accessor = function (newValue){
                var preValue = originalModel[key];
                if(arguments.length) { //set
                    if (stopRepeatAssign) {
                        return //阻止重复赋值
                    }
                    //确定是新设置值
                    if (!isEqual(preValue, newValue)) {
                        originalModel[name] = newValue //更新$model中的值
                        //自身的依赖更新
                        notifySubscribers(accessor);
                    }
                } else {
                    collectSubscribers(accessor) //收集视图函数
                    return accessor.$vmodel || preValue;
                }
            }

            accessor[subscribers] = []; //订阅者数组
        }

        //保存某个属性的控制器
        accessingProperties[key] = accessor;
    }




    /********************节点绑定****************************/
    var scanTag = MVVM.scanTag = function (element, vModel){
        var div = document.getElementById('aa-attr');
        var p_text = document.getElementById('aa-text');

        var bindings = [];  //存储绑定数据

        //属性绑定
        var attrs = div.attributes;
        $.each(attrs, function (index, attr){
            var match;

            if(match = attr.name.match(/vm-(\w+)-?(.*)/)){   //e.g vm-css-width || vm-click
                var type = match[1];
                var param = match[2];

                var binding = {
                    type: type,
                    param: param,
                    element: div,
                    name: match[0],
                    value: attr.value
                }

                bindings.push(binding);
            }
        })

        /*
        * 执行绑定  属性绑定和文本绑定分离
        * */
        excuteBindings(bindings, VMODELS['boxCtr']);

        excuteBindings([{
            filters: undefined,
            element: p_text,
            nodeType: 3,
            type: 'text',
            value: 'width'
        }], VMODELS['boxCtr'])
    }


    function excuteBindings(bindings, vModel){
        $.each(bindings, function (i, data){
            //根据type执行对应的绑定函数
            bindingHandlers[data.type](data, vModel);

            if(data.evaluator && data.name) {   //已经存在求值表达式
                data.element.removeAttribute(data.name);
            }
        })
    }


    function parseExprProxy(code, scopes, data){
        parseExpr(code, scopes, data);

        if(data.evaluator) {
            //找到对应的处理句柄
            data.handler = bindingExecutors[data.type]

            //标识函数, data.evaluator通过Function生成的匿名函数
            data.evaluator.toString = function (){
                return data.type + 'binding to eval('+ code + ')'
            }

            //方便调试
            //这里非常重要,我们通过判定视图刷新函数的element是否在DOM树决定
            //将它移出订阅者列表
            registerSubscriber(data)
        }
    }

    /**
     * 通过code, code.value expose 生成求值表达式
     *
     * @param {String} code
     * @param {Object} vm
     * @param {Object} data
     */
    function parseExpr(code, scopes, data){
        //code 为data.value

        var dataType = data.type;
        var name = 'vm' + expose
        var prefix = 'var ' + data.value + '=' + name + '.' + data.value;

        //作为data.evaluator 的参数传入
        data.args = [scopes];
        code = '\nreturn ' + data.value + ';';

        //name 作为args 连接的元素作为函数体
        // e.g
        // use strict;
        // var width = vm.width
        // return width
        var fn = Function.apply(noop, [name].concat(" 'use strict';\n" + prefix + ";" + code))

        data.evaluator = fn;
    }


    /*********************************************************************
     *                         依赖收集与触发                             *
     **********************************************************************/
    function registerSubscriber(data){
        MVVM.openComputedCollect = true //排除事件处理函数
        var fn = data.evaluator
        if(fn){
            console.log(fn.apply(0, data.args))
            data.handler(fn.apply(0, data.args), data.element, data);
        }
        MVVM.openComputedCollect = false
    }

    var bindingHandlers = {
        css: function (data, vModel){
            var text = data.value.trim();
            //handleName用于处理多种绑定共用同一种bindingExecutor的情况
            data.handerName = 'attr';
            parseExprProxy(text, vModel, data);
        },
        click: function (data, vModel){
            var value = data.value;
            data.type = 'on';
            data.hasArgs = void 0;
            data.handerName = 'on';
            parseExprProxy(data.value, vModel, data);
        },
        text: function (data, vModel){
            parseExprProxy(data.value, vModel, data);
        }
    }

    var bindingExecutors = {
        //修改css
        css: function (val, elem, data){
            var attrname = data.param;
            $(elem).css(attrname, val);
        },
        text: function (val, elem, data){
            $(elem).text(val);
        },
        on: function (val, elem, data){
            var args = data.args;

            var callback = function (e){
                return val.call(this, e);
            }

            elem.addEventListener('click', callback, false)
            data.evaluator = data.handler = noop
        }
    }
})();