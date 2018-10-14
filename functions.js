'use strict';

const METHOD = 'GET';
const DATA_URL = 'http://213.108.129.190/xml/get-temp-data';

let syncDownloadData = function () {
    let request = new XMLHttpRequest();
    request.open(METHOD, DATA_URL, false);
    request.send();

    if(request.status === 200) {
        return JSON.parse(request.responseText);
    }
    return false;
};

/*
* получение свойства объекта
* можно получать в таком виде
* Key1.Key2.Key3
* а также получать конкретные ключи из списка элементов
* Items.*.ItemProp
* проверки на существование и тд реализованы тут же
* */
let getProp = function(data, keyStack){
    if(typeof (keyStack) === 'string'){
        keyStack = keyStack.split('.');
    }
    if(!keyStack.length){
        return data;
    } else{
        let key = keyStack.shift();

        if(data[key]){
            return getProp(data[key], keyStack.slice());
        }else if(key === '*') {
            let tmpArr = [];
            for(let item of data){
                tmpArr.push(getProp(item, keyStack.slice()));
            }
            return tmpArr;
        }else{
            return null;
        }
    }
};

let getMainProps = function(data){
    let keys = {
        GlobalCode_Value : 'GlobalCode_Value',
        Description : 'MarketingProduct.Description',
        CommunicationType : 'MarketingProduct.CommunicationType.Title',
        ServiceType : 'MarketingProduct.ServiceType.Title',
        Parameters: 'MarketingProduct.Parameters'
    };
    let res = {};
    for(let key in keys){
        res[key] = getProp(data, keys[key]) || undefined;
    }
    res['Title'] = 'Основные';
    res['ScreenName'] = res['Title'];

    //если указана группа, то убираем параметр из основных данных, он будет выведен в своей группе
    res['Parameters'] = res['Parameters'].filter(function(parameter){
        return !('Group' in parameter) && ('Value' in parameter);
    });
    return res;
};

let getRegions = function(data){
    let propMTSSiteUrlTemplate = getProp(data, 'MTSSiteUrlTemplate');
    let propMarketingProductAliac = getProp(data, 'MarketingProduct.Alias')
    let regions = getProp(data, 'Regions');
    regions = regions.map(function (region) {
        let data = {
            Title : region.Title,
            Urls : []
        };
        for(let urlTemplate of propMTSSiteUrlTemplate){
            data.Urls.push({
                Title : urlTemplate.Title,
                RegionTitle: region.Title,
                Url: urlTemplate.Template
                    .replace('{RegionAlias}', region.Alias + '.')
                    .replace('{ProductAlias}', propMarketingProductAliac),
                Segment : urlTemplate.Segment.Alias
            });
        }
        return data;
    });

    return {
        Title : 'Регионы',
        Regions: regions
    };
};

let uniqueItems = function(items){
    if(!items.length) return [];
    if(typeof (items[0]) === 'object'){
        return items.filter(function(value, index, self){
            return value && value.Id && self.map(item => item.Id).indexOf(value.Id) === index;
        });
    }else{
        return items.filter(function(value, index, self){
            return self.indexOf(value) === index;
        });
    }
};
/*
* ищем по объекту все элементы с нужным ключом
* предполагаем что одинаковые ключи отвечают за однотипные объекты
* в основном используется для Group
* */
let getFindKeys = function(data, propKey){
    let res = [];
    if(propKey in data){
        res.push(data[propKey]);
    }
    for(let key in data){
        if(key === propKey){
            continue;
        }
        if(typeof(data[key]) === 'object'){
            let tmpGroups = getFindKeys(data[key], propKey);
            res = res.concat(tmpGroups);
        }
    }
    return uniqueItems(res);
};



/**
 * получаем список групп
 * */
let getGroups = function(data){
    let groups = getFindKeys(data, 'Group');
    let marketingGroups = getProp(data, 'MarketingProduct.Groups');
    if(marketingGroups){
        groups = uniqueItems(groups.concat(marketingGroups));
    }

    let siteGroups = getProp(data, 'MarketingProduct.SiteGroups');
    if(siteGroups){
        groups = uniqueItems(groups.concat(siteGroups));
    }
    groups = groups.map(group => {
        return {
            Id: group.Id,
            Title: group.Title,
            ScreenName: group.ScreenName || group.Title,
            Items : []
        };
    }).reduce(function (accumulator, currentValue) {
        accumulator[currentValue.Id] = currentValue;
        return accumulator;
    }, {});
    return groups;
};

let parseByGroups = function(data, groups){
    let res = Object.assign(groups);
    for(let key in data){
        if(typeof (data[key]) === 'object'){
            if(key === 'Group'){
                res[data[key].Id].Items.push(data);
            }else{
                let tmpRes = parseByGroups(data[key], groups);
                for(let tmpKey in tmpRes){
                    if(tmpKey in res) {
                        res[tmpKey].Items = uniqueItems(res[tmpKey].Items.concat(tmpRes[tmpKey].Items));
                        res[tmpKey].Items = res[tmpKey].Items.sort(function(a ,b){
                            let orderA = parseInt(a.SortOrder || 0);
                            let orderB = parseInt(b.SortOrder || 0);
                            if(orderA > orderB){
                                return 1;
                            }
                            if(orderB > orderA){
                                return -1;
                            }
                            return 0;
                        });
                    }
                }
            }
        }
    }
    return res;
};


let processData = function(data){
    let groupsItems = parseByGroups(data, getGroups(data));
    let listData = [];
    for(let key in groupsItems){
        listData.push(groupsItems[key]);
    }
    listData.push(getMainProps(data));
    listData.push(getRegions(data));


    let result = {};
    for(let group of listData){
        let addItem = Object.assign(group);
        if('Items' in addItem){
            addItem.Items = group.Items.reduce(function (accumulator, currentValue) {
                if('Value' in currentValue) {
                    accumulator[currentValue.Title] = currentValue.Value;
                }else if(('NumValue' in currentValue) && ('Unit' in currentValue)){
                    accumulator[currentValue.Title] = currentValue.NumValue + ' ' + currentValue.Unit.Display;
                }else{
                    accumulator[currentValue.Title] = currentValue.Title || '';
                }
                return accumulator;
            }, {});/**/
        }
        if('Parameters' in addItem){
            for(let parameter of addItem.Parameters){
                addItem[parameter.Title] = parameter.Value;
            }
            delete addItem.Parameters;
        }
        if('Regions' in addItem){
            for(let region of addItem.Regions){
                let regionToAdd = {
                };
                for(let url of region.Urls){
                    regionToAdd[url.Title] = url.Url;
                }
                addItem[region.Title] = regionToAdd;
            }
            delete addItem.Regions;
        }

        result[group.Title] = addItem;
        delete group.Title;
    }

    return result;
};
