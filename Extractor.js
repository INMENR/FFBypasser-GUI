//paste the urls u got here
const links = []

async function extractAll() {
    console.log("%c🚀 Starting Fucking Fast Link Extractor in Browser", "color: #00ff00; font-size: 16px; font-weight: bold;");
    const results = [];
    
    for (let i = 0; i < links.length; i++) {
        const link = links[i];
        try {
            const url = new URL(link);
            const id = url.pathname.split('/').pop(); 
            const postUrl = `/f/${id}/go`;
            
            const res = await fetch(postUrl, { method: 'POST' });
            
            const dlUrl = res.headers.get('hx-redirect');
            if (dlUrl) {
                console.log(`%c[${i+1}/${links.length}] ✅ ${dlUrl}`, "color: #00ff00");
                results.push(dlUrl);
            } else {
                console.log(`%c[${i+1}/${links.length}] ❌ Failed to get hx-redirect for ${link}`, "color: #ff0000");
            }
        } catch (e) {
             console.log(`%c[${i+1}/${links.length}] ❌ Error for ${link}: ${e.message}`, "color: #ff0000");
        }
        
        await new Promise(r => setTimeout(r, 1000));
    }
    
    console.log("%c\n\n🎉 Extraction Complete! Here are your direct links:\n", "color: #00ff00; font-size: 14px; font-weight: bold;");
    console.log(results.join('\n'));
    
    const blob = new Blob([results.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Out_Direct_Links.txt';
    a.click();
    URL.revokeObjectURL(url);
}

extractAll();
