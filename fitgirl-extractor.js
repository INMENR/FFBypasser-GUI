{
    const anchors = document.querySelectorAll('a[href*="fuckingfast.co"]');
    
    let urls = Array.from(anchors).map(a => a.href);
    
    urls = [...new Set(urls)];
    
    const arrayString = JSON.stringify(urls, null, 4);
    
    copy(arrayString);
    
    console.log("%c🎉 Successfully extracted " + urls.length + " FuckingFast links!", "color: #00ff00; font-size: 16px; font-weight: bold;");
    console.log("%cThe array has been copied to your clipboard! You can now paste it directly into your devtools_extractor.js script.", "color: #38bdf8; font-size: 14px;");
}
