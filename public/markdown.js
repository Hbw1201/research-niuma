export function escapeHtml(value) {
  return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function inline(text) {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map(part=>{
    if(part.startsWith('`')&&part.endsWith('`')&&part.length>2)return '<code>'+escapeHtml(part.slice(1,-1))+'</code>';
    if(part.startsWith('**')&&part.endsWith('**')&&part.length>4)return '<strong>'+escapeHtml(part.slice(2,-2))+'</strong>';
    return escapeHtml(part);
  }).join('');
}

export function markdown(text,{chat=false}={}) {
  const html=[],paragraph=[];
  let code=null, list='';
  function flushParagraph(){if(paragraph.length)html.push('<p>'+inline(paragraph.splice(0).join('\n'))+'</p>');}
  function closeList(){if(list){html.push('</'+list+'>');list='';}}
  function closeCode(){html.push('<pre><code>'+escapeHtml(code.join('\n'))+'</code></pre>');code=null;}
  for(const line of String(text).split(/\r?\n/)){
    if(/^\s*```/.test(line)){
      if(code!==null)closeCode();else{flushParagraph();closeList();code=[];}
      continue;
    }
    if(code!==null){code.push(line);continue;}
    const item=line.match(/^\s*(?:([-*+])|\d+[.)])\s+(.*)$/);
    if(item){flushParagraph();const kind=item[1]?'ul':'ol';if(kind!==list){closeList();list=kind;html.push('<'+list+'>');}html.push('<li>'+inline(item[2])+'</li>');continue;}
    closeList();
    const heading=line.match(/^(#{1,6})\s+(.*)$/);
    if(heading){flushParagraph();const n=Math.min(6,heading[1].length+(chat?2:0));html.push('<h'+n+'>'+inline(heading[2])+'</h'+n+'>');}
    else if(!line.trim())flushParagraph();
    else paragraph.push(line);
  }
  flushParagraph();closeList();if(code!==null)closeCode();
  return html.join('');
}
