let manifest = chrome.runtime.getManifest();
let commands = manifest.commands;
let commandsArray = [];
loadCommands();

let darkmode = window.matchMedia('(prefers-color-scheme: dark)').matches;
chrome.storage.local.set({darkmode})

if (darkmode) {
  chrome.action.setIcon({path: {32:'../rsrc/wrench-light_32.png'}});
} else {
  chrome.action.setIcon({path: {32:'../rsrc/wrench_32.png'}});
}

function loadCommands() {

  for (let cmd in commands) {
    let attrs = commands[cmd];
    attrs.name = cmd;
    if (attrs.description)
      attrs.description = attrs.description.split(" (")[0];
    if (!attrs.group) continue;
    commandsArray.push(attrs);
  }
  commandsArray.sort((a,b) => {
    let order =  a.group ? a.group.localeCompare(b.group) : 1;
    if (!order) order = a.order - b.order;
    return order; 
  })

  chrome.commands.getAll((cmds) => {
    cmds.forEach(cmd => {
      if (cmd.shortcut) commands[cmd.name].shortcut = cmd.shortcut;
    })
    m.redraw();
  })
}


let focusedTabs;
document.addEventListener('DOMContentLoaded', function() {
  chrome.tabs.query({ highlighted: true, currentWindow: true }).then ( tabs => {
    focusedTabs = tabs
    console.log("Rendering menu for", tabs);
    var root = document.body;
    m.mount(root, Menu);
  });
  
})



function openShortcutsUI() {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts#:~:text=" + encodeURIComponent(this)});
}

var MenuItem = function(vnode) {
  return {
    view: function(vnode) {
      let item = vnode.attrs;
      let attrs = {onclick:runCommand.bind(item)}
      let title = item.description ?? item.title;
      if (item.type == 'separator') return m('hr')
      if (item.type == 'header') return m('div.header', item.description);
      if (!item.description) return;
      if (item.onclick) attrs.onclick = item.onclick;
      return m('div.item', attrs,
        m('span.icon.material-icons',item.icon), 
        m('span.title', title),
        item.shortcut ? m('span.shortcut', {onclick:openShortcutsUI.bind(title)}, item.shortcut) : m('span.shortcut.placeholder', {onclick:openShortcutsUI.bind(title)}, "+")
      )
    }
  }

}
var Menu = function(vnode) {
  return {
     view: function(vnode) {
        let menuItems = []
        let lastGroup;
        for (let cmd in commandsArray) {
          let attrs = commandsArray[cmd];
          if (!attrs.description) continue;
          if (lastGroup != attrs.group) {
            if (lastGroup) menuItems.push(m(MenuItem, {type:"separator", description:lastGroup}))
            lastGroup = attrs.group
            let header = lastGroup;
            if (header == "Tab") {
              if (focusedTabs.length > 1) header = focusedTabs.length + " Tabs"
            }
            menuItems.push(m(MenuItem, {type:"header", description:header}))
          }
          menuItems.push(m(MenuItem, attrs))
        }

        menuItems.push(m('hr'))
        menuItems.push(m(MenuItem, {description:"More keyboard shortcuts...",  icon:'keyboard', onclick:openShortcutsUI.bind("The Wrench Menu")}))
        return m("div.menu#contextmenu", menuItems);
    }
  }
}

function runCommand(e) {
  let el = e.target.closest(".item")
  el.classList.add("nohighlight");
  setTimeout(() => {
    el.classList.remove("nohighlight");
    el.classList.add("highlight");
    console.log("Run command:", this.name)
    if (commandHandlers[this.name]) {
      commandHandlers[this.name]()
    } else {
      sendMessage(this);
    }
    setTimeout(() => {
      el.classList.remove("highlight");
      if (!e.shiftKey) window.close();
    },150)
  },100)
}

let commandHandlers = {
  "pic-in-pic": pictureInPicture,
  "copy-link": copyLink
}

function sendMessage(command) {
  return chrome.runtime.sendMessage({command, tabs:focusedTabs});
}

// Commands

async function pictureInPicture(target) {
  if (!target) target = (await chrome.tabs.query({active: true, currentWindow: true}))[0];
  chrome.scripting.executeScript({
    files: ['./src/inject_pictureInPicture.js'],
    target: {tabId:target.id, allFrames:true}
  });
}

async function copyLink() {
  let tab = (await chrome.tabs.query({active: true, currentWindow: true}))[0];
  try {
    const text = new Blob([`${tab.title}\n${tab.url}`], {type: 'text/plain'});
    const html = new Blob([`<a href="${tab.url}">${tab.title}</a>`], {type: 'text/html'});
    const item = new ClipboardItem({
      'text/plain': text,
      'text/html': html
    });
    await navigator.clipboard.write([item]);
    console.log('Page URL copied to clipboard');
  } catch (err) {
    console.error('Failed to copy: ', err);
  }
}