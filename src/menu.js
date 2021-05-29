let manifest = chrome.runtime.getManifest();
let commands = manifest.commands;
let editMode = false;
let commandsArray = [];
let settings = {}
let storage = chrome.storage.sync;

storage.get('settings', result => { console.log("result", result); settings = result.settings})

function writeSettings () {
  storage.set({settings});
}

loadCommands();

let darkmode = window.matchMedia('(prefers-color-scheme: dark)').matches;
chrome.storage.local.set({darkmode})

if (darkmode) {
  chrome.action.setIcon({path: {32:'../rsrc/wrench-light_32.png'}});
} else {
  chrome.action.setIcon({path: {32:'../rsrc/wrench_32.png'}});
}

function loadCommands() {
  let groupOrder = ["Tab", "Window", "Shortcuts"];

  for (let cmd in commands) {
    let attrs = commands[cmd];
    attrs.name = cmd;
    attrs.groupIndex = groupOrder.indexOf(attrs.group)
    if (attrs.description)
      attrs.description = attrs.description.split(" (")[0];
    //if (!attrs.group) continue;
    commandsArray.push(attrs);
  }
  commandsArray.sort((a,b) => {
    let order =  a.groupIndex - b.groupIndex;
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
  async function toggleEnabled(enabled, e) {
    e.preventDefault();
    e.stopPropagation();
    settings[this.name] = !enabled;
    writeSettings();
  }
  return {
    view: function(vnode) {
      let item = vnode.attrs;
      let attrs = {onclick:runCommand.bind(item)}
      let title = item.description ?? item.title;
      if (item.type == 'separator') return m('hr')
      if (item.type == 'header') return m('div.header', item.description);
      if (!item.description) return;
      if (item.onclick) attrs.onclick = item.onclick;
      let enabled = settings[item.name] ?? !item.hidden;
      if (!enabled && !editMode) return;
      if (focusedTabs.length > 1 && item.plural_description) title = item.plural_description;
      if (enabled) attrs.class = "enabled"
      return m('div.item', attrs,
        (editMode && !item.permanent) ? m('span.icon.checkbox.material-icons', {onclick: toggleEnabled.bind(item, enabled)}, enabled ? "check_box" : "check_box_outline_blank") : null, 
        m('span.icon.material-icons',item.icon), 
        m('span.title', title),
        item.permanent ? null : item.shortcut ? m('span.shortcut', {onclick:openShortcutsUI.bind(title)}, item.shortcut) : m('span.shortcut.placeholder.material-icons', {onclick:openShortcutsUI.bind(title)}, "add")
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

          let enabled = settings[attrs.name] ?? !attrs.hidden;
          if (!enabled && !editMode) continue;
          if (lastGroup != attrs.group) {
            if (lastGroup) menuItems.push(m(MenuItem, {type:"separator", description:lastGroup}))
            lastGroup = attrs.group
            let header = lastGroup;
            if (header == "Tab") {
              if (focusedTabs.length > 1) {
                header = focusedTabs.length + " Tabs"
              } else {
                header += " - " + focusedTabs[0].title
              }
            }
            menuItems.push(m(MenuItem, {type:"header", description:header}))
          }
          menuItems.push(m(MenuItem, attrs))
        }
        let attrs = {}
        if (editMode) attrs.class = "edit";
        menuItems.push(m('hr'))
        menuItems.push(m(MenuItem, {permanent:true, description:"Keyboard shortcuts...",  icon:'keyboard', onclick:openShortcutsUI.bind("The Wrench Menu")}))
        menuItems.push(m(MenuItem, {permanent:true, 
          description: editMode ? "Hide Unchecked Commands" : "Show All Commands", 
           icon: editMode ? 'keyboard_arrow_up' : 'keyboard_arrow_down', 
           onclick:toggleEditMode}))
        return m("div.menu#contextmenu", attrs,  menuItems);
    }
  }
}


function toggleEditMode () {
  editMode = !editMode;
  m.redraw;
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
  "03-pic-in-pic": pictureInPicture,
  "20-copy-link": copyLink
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
  let tabs = await chrome.tabs.query({highlighted: true, currentWindow: true});
  let textLines = [];
  let htmlLines = [];

  tabs.forEach(tab => {
    textLines.push(`${tab.title} \n${tab.url}`);
    htmlLines.push(`<a href="${tab.url}">${tab.title}</a>`);
  })

  copyRichText(textLines.join("\n \n"), htmlLines.join("<br>"));
}

async function copyRichText(text, html) {
  try {
    const item = new ClipboardItem({
      'text/plain': new Blob([text], {type: 'text/plain'}),
      'text/html': new Blob([html], {type: 'text/html'})
    });
    await navigator.clipboard.write([item]);
    console.log('Copied to clipboard', title, url);
  } catch (err) {
    console.error('Failed to copy: ', err);
  }
}