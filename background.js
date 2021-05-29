chrome.commands.onCommand.addListener(runCommand);

chrome.contextMenus.onClicked.addListener((data, tab) =>  {
  runCommand(data.menuItemId, tab)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  runCommand(message.command.name, message.tab)
  sendResponse();
});



// Context Menu

function setup() {
  let manifest = chrome.runtime.getManifest();
  let commands = manifest.commands;
  for (let id in commands) {
    let c = commands[id];
    if (!c.description) continue;
    if (!c.contexts) continue;
    let description = c.description
    description = description.split(" (")[0];
    chrome.contextMenus.create({
      title: description,
      id: id,
      contexts: c.contexts
    });
  }

  restoreIcon();
}

function showSuccess() {
  chrome.action.setIcon({path: 'rsrc/checkmark_32.png'});
  setTimeout(restoreIcon, 1000);
}
function restoreIcon() {
  chrome.storage.local.get('darkmode', (value) => {
    chrome.action.setIcon({path: `rsrc/wrench${value.darkmode ? "-light" : ""}_32.png`})
  })
}


chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

let storage = chrome.storage.session || chrome.storage.local
chrome.tabs.onActivated.addListener( async info => {
  storage.get('tabHistory', value => {
    value = value.tabHistory || []
    value.unshift(info);
    storage.set({'tabHistory':value.slice(0, 10)})
  })
});

// Commands

let commandHandlers = {
  "01-pin-tab": async (tab) => {
    chrome.tabs.update(tab.id, { 'pinned': !tab.pinned });
  },
  "02-pop-out-tab": async (tab) => {
    let window = await chrome.windows.get(tab.windowId)
    console.log("Pop out", tab, window)
    if (window.type == 'normal') {
      chrome.windows.create({
        tabId: tab.id,
        left:window.left + 52, top:window.top + 52, width:window.width - 104 , height:window.height - 104,
        type: "popup"
      });
    } else {
      //TODO: record the window the tab came from originally 
      window = (await chrome.windows.getAll({populate:false, windowTypes:['normal']}))[0]
      await chrome.tabs.move(tab.id, {windowId:window.id, index:-1})
      chrome.tabs.update(tab.id, { 'active': true });
      chrome.windows.update(window.id, {"focused": true });
    }
  },

  
  "02-tab-to-window": async (tab) => {
    let window = await chrome.windows.get(tab.windowId)
    chrome.windows.create({
      tabId: tab.id,
      left:window.left, top:window.top, width:window.width , height:window.height,
      type: "normal"
    });
    //TODO: record the window the tab came from originally 
  },
  
  "03-pic-in-pic": async (tab) => {
    chrome.scripting.executeScript({
      files: ['./src/inject_pictureInPicture.js'],
      target: {tabId:tab.id, allFrames:true}
    });
    showSuccess();
  },

  "20-copy-link": async (tab) => {
    chrome.scripting.executeScript({
      files: ['./src/inject_copyLink.js'],
      target: {tabId:tab.id, allFrames:true}
    });
    showSuccess();
  },

  "90-close-downloads": () => {
    chrome.permissions.request({permissions: ['downloads', 'downloads.shelf']}, function(granted) {
      if (granted) {
        chrome.downloads.setShelfEnabled(false);
        chrome.downloads.setShelfEnabled(true);
      }
    });
    showSuccess();
  },

  "13-new-tab-right": async (tab) => {
    // TODO: Reactivate last used tabbed window
    chrome.tabs.create({
      index: tab.index + 1
    }).then((tab) => { 
      if (tab.groupId > 0) chrome.tabs.group({groupId: tab.groupId, tabIds: tab.id})
    });
  },

  "53-remove-duplicates": function removeDuplicates(tab) {
    chrome.windows.getAll({populate:true, windowTypes:['normal']})
    .then((windows) => {
      var idsToRemove = []
      var knownURLs = {};
      windows.forEach(w => {
        w.tabs.forEach((tab) => {
          let url = tab.url;
          let priorTab = knownURLs[url];
          if (!priorTab) {
            knownURLs[url] = tab;
          } else if (tab.groupId == -1) {
            idsToRemove.push(tab.id)         
          }
        })
        chrome.tabs.remove(idsToRemove.reverse());
      })
    })
    showSuccess();
  },

  "12-previous-tab": () => {
    let storage = chrome.storage.session || chrome.storage.local
    storage.get('tabHistory', value => {
      if (value.tabHistory) {
        let info = value.tabHistory[1];
        chrome.tabs.update(info.tabId, { 'active': true });
        chrome.windows.update(info.windowId, { "focused": true });
      }
    })  
  },

  "51-merge-windows": mergeWindows,

  "55-discard-tabs": async () => {
    let windows = await chrome.windows.getAll({populate:true, windowTypes:['normal']});
    windows.forEach(w => {
      w.tabs.forEach(tab => {
        if (!tab.active && !tab.discarded) chrome.tabs.discard(tab.id)
      })  
    })
    showSuccess();
  }
}

async function mergeWindows() {
  let activeTab = (await chrome.tabs.query({active: true, currentWindow: true}))[0];
  let windows = await chrome.windows.getAll({populate:true, windowTypes:['normal']});
  windows.sort(sortWindows);
  let firstWindow = windows.shift();
  let movedGroups = [];
  for (var w of windows) {
    for (var tab of w.tabs) {
      if (tab.groupId > 0 && !movedGroups.includes(tab.groupId)) {
        await chrome.tabGroups.move(tab.groupId,{windowId:firstWindow.id, index:-1})
        movedGroups.push(tab.groupId);
      } else {
        await chrome.tabs.move(tab.id, {windowId:firstWindow.id, index:-1})
        //.then(() => {
          if (tab.pinned) chrome.tabs.update(tab.id, { pinned: true }) 
        //});
      }
    }
  }

  // Dedupe groups
  let groupsArray = await chrome.tabGroups.query({});
  var groups = groupsArray.reduce((map, obj) => {
    map[obj.id] = obj;
    return map;
  }, {});

  let tabs = await chrome.tabs.query({windowId:firstWindow.id});
  let groupTitles = {}
  for (var tab of tabs) {
    if (tab.groupId == -1) continue;
    let group = groups[tab.groupId];
    let newGroup = groupTitles[group.title]
    if (newGroup) {
      await chrome.tabs.group({groupId:newGroup, tabIds:tab.id});
    } else if (group.title.length) {
      groupTitles[group.title] = group.id;
    }
  }

  chrome.tabs.update(activeTab.id, { 'active': true });
  showSuccess();
}

async function runCommand(command, tab) {
  if (commandHandlers[command]) {
    if (!tab) tab = (await chrome.tabs.query({active: true, currentWindow: true}))[0];
    console.log("Run command:", command, tab)
    commandHandlers[command](tab)
  } else {
    console.error("Command unknown:", command.name)
  }
}

function sortWindows(w1,w2) {
  let i, j;
  for (i = 0; i < w1.tabs.length; i++) { if (!w1.tabs[i] || !w1.tabs[i].pinned) break; }
  for (j = 0; j < w1.tabs.length; j++) { if (!w2.tabs[j] || !w2.tabs[j].pinned) break; } 
  if (j - i == 0) return w2.tabs.length - w1.tabs.length;
  return j - i;
}

