let manifest = chrome.runtime.getManifest();
let commands = manifest.commands;
let editMode = false;
let commandsArray = [];
let settings = {}
let storage = chrome.storage.sync;

storage.get('settings', result => { console.log("result", result); settings = result.settings ?? {}})

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
  let groupOrder = ["Tab", "Tab Group", "Window", "Shortcuts"];

  for (let cmd in commands) {
    let attrs = commands[cmd];
    if (attrs.shortcut_only) continue;
    attrs.name = cmd;
    attrs.groupIndex = groupOrder.indexOf(attrs.group)
    if (attrs.description)
      attrs.description = attrs.description.split(" (")[0];
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
let focusedGroup;
let focusedText;
function getSelectedText() { return document.getSelection().toString(); }

document.addEventListener('DOMContentLoaded', async function() {
  let tabs = await chrome.tabs.query({ highlighted: true, currentWindow: true })

  let groupId = tabs[0].groupId;
  if (groupId > 0) focusedGroup = await chrome.tabGroups.get(groupId);
  focusedTabs = tabs

  console.log("Rendering menu for", tabs, focusedGroup);
  var root = document.body;
  m.mount(root, Menu);

})

console.log("this", this, self)

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
      if (item.type == 'header') return m('div.header',
        item.description,
        item.subtitle ? m('span.subtitle', item.subtitle) : null
        );
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
            let subtitle;
            if (header == "Tab") {
              if (focusedTabs.length > 1) {
                header = focusedTabs.length + " Tabs"
              } else {
                subtitle = " - " + focusedTabs[0].title
              }
            }
            if ((header == "Tab Group") && focusedGroup) {
                subtitle = " - " + focusedGroup.title
            }
            menuItems.push(m(MenuItem, {type:"header", description:header, subtitle}))
          }
          menuItems.push(m(MenuItem, attrs))
        }
        let attrs = {}
        if (editMode) attrs.class = "edit";
        menuItems.push(m('hr'))
        menuItems.push(m(MenuItem, {permanent:true, description:"Keyboard shortcuts...",  icon:'keyboard', onclick:openShortcutsUI.bind("The Wrench Menu")}))
        menuItems.push(m(MenuItem, {permanent:true, 
          description: editMode ? "Hide Unchecked Items" : "Show All Menu Items", 
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
    console.log("Run command:", this, self, this.action, commandHandlers)

    if (commandHandlers[this.action]) {
      commandHandlers[this.action]()
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
  "pictureInPicture": pictureInPicture,
  "copyLink": copyLink
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
  let data = await clipboardDataForTabs()
  if (data) await copyDataToClipboard(data);
  chrome.runtime.sendMessage({success:true});
}





// Duplicate functions from Background.js


async function clipboardDataForTabs(tab) {
  let tabs = await chrome.tabs.query({highlighted: true, currentWindow: true});
  if (!tabs.length) return;

  let textLines = [];
  let htmlLines = [];
  let selectedText;

  if (tabs.length == 1) {
    tab = tabs[0]
    selectedText = (await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      func: () => { return document.getSelection().toString(); }
    })).shift().result;
    if (!selectedText.length) selectedText = undefined;
  }

  tabs.forEach(tab => {
    textLines.push(`${selectedText || tab.title} \n${tab.url}`);
    htmlLines.push(`<a href="${tab.url}">${selectedText || tab.title}</a>`);
  })

  return {
    text: textLines.join("\n \n"),
    html: htmlLines.join("<br>")
  }
}

async function copyDataToClipboard(data) {
  console.log("Copying data to clipboard", data);
  try {
    const item = new ClipboardItem({
      'text/plain': new Blob([data.text], {type: 'text/plain'}),
      'text/html': new Blob([data.html], {type: 'text/html'})
    });
    navigator.clipboard.write([item]);
  } catch (err) {
    console.error('Failed to copy: ', err);
  }
}