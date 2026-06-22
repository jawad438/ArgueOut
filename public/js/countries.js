/* countries.js — searchable country picker (reusable) */
var COUNTRIES = [
  {f:'🇦🇫',n:'Afghanistan'},{f:'🇦🇱',n:'Albania'},{f:'🇩🇿',n:'Algeria'},
  {f:'🇦🇩',n:'Andorra'},{f:'🇦🇴',n:'Angola'},{f:'🇦🇬',n:'Antigua and Barbuda'},
  {f:'🇦🇷',n:'Argentina'},{f:'🇦🇲',n:'Armenia'},{f:'🇦🇺',n:'Australia'},
  {f:'🇦🇹',n:'Austria'},{f:'🇦🇿',n:'Azerbaijan'},{f:'🇧🇸',n:'Bahamas'},
  {f:'🇧🇭',n:'Bahrain'},{f:'🇧🇩',n:'Bangladesh'},{f:'🇧🇧',n:'Barbados'},
  {f:'🇧🇾',n:'Belarus'},{f:'🇧🇪',n:'Belgium'},{f:'🇧🇿',n:'Belize'},
  {f:'🇧🇯',n:'Benin'},{f:'🇧🇹',n:'Bhutan'},{f:'🇧🇴',n:'Bolivia'},
  {f:'🇧🇦',n:'Bosnia and Herzegovina'},{f:'🇧🇼',n:'Botswana'},{f:'🇧🇷',n:'Brazil'},
  {f:'🇧🇳',n:'Brunei'},{f:'🇧🇬',n:'Bulgaria'},{f:'🇧🇫',n:'Burkina Faso'},
  {f:'🇧🇮',n:'Burundi'},{f:'🇨🇻',n:'Cabo Verde'},{f:'🇰🇭',n:'Cambodia'},
  {f:'🇨🇲',n:'Cameroon'},{f:'🇨🇦',n:'Canada'},{f:'🇨🇫',n:'Central African Republic'},
  {f:'🇹🇩',n:'Chad'},{f:'🇨🇱',n:'Chile'},{f:'🇨🇳',n:'China'},
  {f:'🇨🇴',n:'Colombia'},{f:'🇰🇲',n:'Comoros'},{f:'🇨🇬',n:'Congo (Republic)'},
  {f:'🇨🇩',n:'Congo (DR)'},{f:'🇨🇷',n:'Costa Rica'},{f:'🇭🇷',n:'Croatia'},
  {f:'🇨🇺',n:'Cuba'},{f:'🇨🇾',n:'Cyprus'},{f:'🇨🇿',n:'Czechia'},
  {f:'🇩🇰',n:'Denmark'},{f:'🇩🇯',n:'Djibouti'},{f:'🇩🇲',n:'Dominica'},
  {f:'🇩🇴',n:'Dominican Republic'},{f:'🇪🇨',n:'Ecuador'},{f:'🇪🇬',n:'Egypt'},
  {f:'🇸🇻',n:'El Salvador'},{f:'🇬🇶',n:'Equatorial Guinea'},{f:'🇪🇷',n:'Eritrea'},
  {f:'🇪🇪',n:'Estonia'},{f:'🇸🇿',n:'Eswatini'},{f:'🇪🇹',n:'Ethiopia'},
  {f:'🇫🇯',n:'Fiji'},{f:'🇫🇮',n:'Finland'},{f:'🇫🇷',n:'France'},
  {f:'🇬🇦',n:'Gabon'},{f:'🇬🇲',n:'Gambia'},{f:'🇬🇪',n:'Georgia'},
  {f:'🇩🇪',n:'Germany'},{f:'🇬🇭',n:'Ghana'},{f:'🇬🇷',n:'Greece'},
  {f:'🇬🇩',n:'Grenada'},{f:'🇬🇹',n:'Guatemala'},{f:'🇬🇳',n:'Guinea'},
  {f:'🇬🇼',n:'Guinea-Bissau'},{f:'🇬🇾',n:'Guyana'},{f:'🇭🇹',n:'Haiti'},
  {f:'🇭🇳',n:'Honduras'},{f:'🇭🇺',n:'Hungary'},{f:'🇮🇸',n:'Iceland'},
  {f:'🇮🇳',n:'India'},{f:'🇮🇩',n:'Indonesia'},{f:'🇮🇷',n:'Iran'},
  {f:'🇮🇶',n:'Iraq'},{f:'🇮🇪',n:'Ireland'},{f:'🇮🇱',n:'Israel'},
  {f:'🇮🇹',n:'Italy'},{f:'🇯🇲',n:'Jamaica'},{f:'🇯🇵',n:'Japan'},
  {f:'🇯🇴',n:'Jordan'},{f:'🇰🇿',n:'Kazakhstan'},{f:'🇰🇪',n:'Kenya'},
  {f:'🇰🇮',n:'Kiribati'},{f:'🇰🇼',n:'Kuwait'},{f:'🇰🇬',n:'Kyrgyzstan'},
  {f:'🇱🇦',n:'Laos'},{f:'🇱🇻',n:'Latvia'},{f:'🇱🇧',n:'Lebanon'},
  {f:'🇱🇸',n:'Lesotho'},{f:'🇱🇷',n:'Liberia'},{f:'🇱🇾',n:'Libya'},
  {f:'🇱🇮',n:'Liechtenstein'},{f:'🇱🇹',n:'Lithuania'},{f:'🇱🇺',n:'Luxembourg'},
  {f:'🇲🇬',n:'Madagascar'},{f:'🇲🇼',n:'Malawi'},{f:'🇲🇾',n:'Malaysia'},
  {f:'🇲🇻',n:'Maldives'},{f:'🇲🇱',n:'Mali'},{f:'🇲🇹',n:'Malta'},
  {f:'🇲🇭',n:'Marshall Islands'},{f:'🇲🇷',n:'Mauritania'},{f:'🇲🇺',n:'Mauritius'},
  {f:'🇲🇽',n:'Mexico'},{f:'🇫🇲',n:'Micronesia'},{f:'🇲🇩',n:'Moldova'},
  {f:'🇲🇨',n:'Monaco'},{f:'🇲🇳',n:'Mongolia'},{f:'🇲🇪',n:'Montenegro'},
  {f:'🇲🇦',n:'Morocco'},{f:'🇲🇿',n:'Mozambique'},{f:'🇲🇲',n:'Myanmar'},
  {f:'🇳🇦',n:'Namibia'},{f:'🇳🇷',n:'Nauru'},{f:'🇳🇵',n:'Nepal'},
  {f:'🇳🇱',n:'Netherlands'},{f:'🇳🇿',n:'New Zealand'},{f:'🇳🇮',n:'Nicaragua'},
  {f:'🇳🇪',n:'Niger'},{f:'🇳🇬',n:'Nigeria'},{f:'🇰🇵',n:'North Korea'},
  {f:'🇲🇰',n:'North Macedonia'},{f:'🇳🇴',n:'Norway'},{f:'🇴🇲',n:'Oman'},
  {f:'🇵🇰',n:'Pakistan'},{f:'🇵🇼',n:'Palau'},{f:'🇵🇸',n:'Palestine'},
  {f:'🇵🇦',n:'Panama'},{f:'🇵🇬',n:'Papua New Guinea'},{f:'🇵🇾',n:'Paraguay'},
  {f:'🇵🇪',n:'Peru'},{f:'🇵🇭',n:'Philippines'},{f:'🇵🇱',n:'Poland'},
  {f:'🇵🇹',n:'Portugal'},{f:'🇶🇦',n:'Qatar'},{f:'🇷🇴',n:'Romania'},
  {f:'🇷🇺',n:'Russia'},{f:'🇷🇼',n:'Rwanda'},{f:'🇰🇳',n:'Saint Kitts and Nevis'},
  {f:'🇱🇨',n:'Saint Lucia'},{f:'🇻🇨',n:'Saint Vincent and the Grenadines'},
  {f:'🇼🇸',n:'Samoa'},{f:'🇸🇲',n:'San Marino'},{f:'🇸🇹',n:'Sao Tome and Principe'},
  {f:'🇸🇦',n:'Saudi Arabia'},{f:'🇸🇳',n:'Senegal'},{f:'🇷🇸',n:'Serbia'},
  {f:'🇸🇨',n:'Seychelles'},{f:'🇸🇱',n:'Sierra Leone'},{f:'🇸🇬',n:'Singapore'},
  {f:'🇸🇰',n:'Slovakia'},{f:'🇸🇮',n:'Slovenia'},{f:'🇸🇧',n:'Solomon Islands'},
  {f:'🇸🇴',n:'Somalia'},{f:'🇿🇦',n:'South Africa'},{f:'🇰🇷',n:'South Korea'},
  {f:'🇸🇸',n:'South Sudan'},{f:'🇪🇸',n:'Spain'},{f:'🇱🇰',n:'Sri Lanka'},
  {f:'🇸🇩',n:'Sudan'},{f:'🇸🇷',n:'Suriname'},{f:'🇸🇪',n:'Sweden'},
  {f:'🇨🇭',n:'Switzerland'},{f:'🇸🇾',n:'Syria'},{f:'🇹🇼',n:'Taiwan'},
  {f:'🇹🇯',n:'Tajikistan'},{f:'🇹🇿',n:'Tanzania'},{f:'🇹🇭',n:'Thailand'},
  {f:'🇹🇱',n:'Timor-Leste'},{f:'🇹🇬',n:'Togo'},{f:'🇹🇴',n:'Tonga'},
  {f:'🇹🇹',n:'Trinidad and Tobago'},{f:'🇹🇳',n:'Tunisia'},{f:'🇹🇷',n:'Turkey'},
  {f:'🇹🇲',n:'Turkmenistan'},{f:'🇹🇻',n:'Tuvalu'},{f:'🇺🇬',n:'Uganda'},
  {f:'🇺🇦',n:'Ukraine'},{f:'🇦🇪',n:'United Arab Emirates'},{f:'🇬🇧',n:'United Kingdom'},
  {f:'🇺🇸',n:'United States'},{f:'🇺🇾',n:'Uruguay'},{f:'🇺🇿',n:'Uzbekistan'},
  {f:'🇻🇺',n:'Vanuatu'},{f:'🇻🇦',n:'Vatican City'},{f:'🇻🇪',n:'Venezuela'},
  {f:'🇻🇳',n:'Vietnam'},{f:'🇾🇪',n:'Yemen'},{f:'🇿🇲',n:'Zambia'},
  {f:'🇿🇼',n:'Zimbabwe'}
];

function countryFlag(name) {
  if (!name) return '';
  var c = COUNTRIES.find(function(c) { return c.n === name; });
  return c ? c.f + ' ' : '';
}

function initCountryPicker(searchId, dropdownId, hiddenId, onChange) {
  var search = document.getElementById(searchId);
  var dd     = document.getElementById(dropdownId);
  var hidden = document.getElementById(hiddenId);
  if (!search || !dd || !hidden) return;

  function render(list) {
    dd.innerHTML = '';
    if (!list.length) {
      dd.innerHTML = '<div class="country-opt country-opt-empty">No results</div>';
    } else {
      list.forEach(function (c) {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'country-opt';
        el.textContent = c.f + ' ' + c.n;
        el.addEventListener('mousedown', function (e) {
          e.preventDefault();
          select(c);
        });
        dd.appendChild(el);
      });
    }
    dd.classList.add('open');
  }

  function select(c) {
    search.value = c.f + ' ' + c.n;
    hidden.value = c.n;
    dd.classList.remove('open');
    dd.innerHTML = '';
    if (onChange) onChange(c.n);
  }

  search.addEventListener('input', function () {
    var q = search.value.toLowerCase().trim();
    hidden.value = '';
    if (!q) { dd.classList.remove('open'); dd.innerHTML = ''; return; }
    render(COUNTRIES.filter(function (c) { return c.n.toLowerCase().indexOf(q) !== -1; }).slice(0, 30));
  });

  search.addEventListener('focus', function () {
    if (!search.value) render(COUNTRIES.slice(0, 30));
  });

  search.addEventListener('blur', function () {
    setTimeout(function () { dd.classList.remove('open'); }, 150);
  });
}

function setCountryPickerValue(searchId, hiddenId, countryName) {
  var search = document.getElementById(searchId);
  var hidden = document.getElementById(hiddenId);
  if (!search || !hidden) return;
  if (countryName) {
    var flag = countryFlag(countryName);
    search.value = flag + countryName;
    hidden.value = countryName;
  } else {
    search.value = '';
    hidden.value = '';
  }
}

document.addEventListener('DOMContentLoaded', function () {
  // Register page
  if (document.getElementById('countrySearch')) {
    initCountryPicker('countrySearch', 'countryDropdown', 'country');
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#countryPicker')) {
        var dd = document.getElementById('countryDropdown');
        if (dd) dd.classList.remove('open');
      }
    });
  }
  // Lobby sidebar
  if (document.getElementById('sidebarCountrySearch')) {
    initCountryPicker('sidebarCountrySearch', 'sidebarCountryDropdown', 'sidebarCountry');
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#sidebarCountryPicker')) {
        var dd = document.getElementById('sidebarCountryDropdown');
        if (dd) dd.classList.remove('open');
      }
    });
  }
});
