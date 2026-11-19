Object.assign(PAGES, typeof PAGES2 === 'undefined' ? {} : PAGES2)
document.title = 'Feedway · ' + P
document.getElementById('root').innerHTML = (PAGES[P] || oggi)()
