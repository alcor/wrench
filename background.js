chrome.commands.onCommand.addListener(runCommand);

chrome.contextMenus.onClicked.addListener((data, tab) =>  {
  return runCommand(data.menuItemId, tab)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.success) return showSuccess();
  return runCommand(message.command.name, message.tab, sendResponse)
})

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

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

// History Stack

let storage = chrome.storage.session || chrome.storage.local
chrome.tabs.onActivated.addListener( async info => {
  storage.get('tabHistory', value => {
    value = value.tabHistory || []
    value.unshift(info);
    storage.set({'tabHistory':value.slice(0, 10)})
  })
});


// Status Icon

function showSuccess() {
  chrome.action.setIcon({path: 'rsrc/checkmark_32.png'});
  setTimeout(restoreIcon, 600);
}

function restoreIcon() {
  chrome.storage.local.get('darkmode', (value) => {
    chrome.action.setIcon({path: `rsrc/wrench${value.darkmode ? "-light" : ""}_32.png`})
  })
}

async function runCommand(commandId, tab) {
  let manifest = chrome.runtime.getManifest();
  let commands = manifest.commands;
  let command = commands[commandId];
  
  if (self[command.action]) {
    if (!tab) tab = (await chrome.tabs.query({active: true, currentWindow: true}))[0];
    console.log("Run command:", command.action, tab)
    self[command.action](tab)
  } else {
    console.error("Command unknown:", command.action)
  }
}


//
// Main Command Set
//

async function pinTab(tab) {
  chrome.tabs.update(tab.id, { 'pinned': !tab.pinned });
}

async function moveTabToPopUp(tab) {
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
}
 
async function moveTabToOwnWindow(tab) {
  let window = await chrome.windows.get(tab.windowId)
  chrome.windows.create({
    tabId: tab.id,
    left:window.left, top:window.top, width:window.width , height:window.height,
    type: "normal"
  });
  //TODO: record the window the tab came from originally 
}
  
async function pictureInPicture(tab) {
  chrome.scripting.executeScript({
    files: ['./src/inject_pictureInPicture.js'],
    target: {tabId:tab.id, allFrames:true}
  });
  showSuccess();
}

async function copyLink(tab) {
  let data = await clipboardDataForTabs(tab)
  if (data) await chrome.scripting.executeScript({
    target: {tabId: tab.id},
    func: copyDataToClipboard,
    args:[data]
  });
}

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

async function closeDownloadsBar() {
  chrome.permissions.request({permissions: ['downloads', 'downloads.shelf']}, function(granted) {
    if (granted) {
      chrome.downloads.setShelfEnabled(false);
      chrome.downloads.setShelfEnabled(true);
    }
  });
  showSuccess();
}

async function newTabToTheRight(tab) {
  // TODO: Reactivate last used tabbed window
  chrome.tabs.create({
    index: tab.index + 1
  }).then((tab) => { 
    if (tab.groupId > 0) chrome.tabs.group({groupId: tab.groupId, tabIds: tab.id})
  });
}

async function tabCleanup(tab) {
  await mergeWindows(tab);
  await removeDuplicateTabs(tab);
  await groupTabsByDomain(tab);
}

async function removeDuplicateTabs(tab) {
  let windows = await chrome.windows.getAll({populate:true, windowTypes:['normal']})
  var idsToRemove = []
  var knownURLs = {};
  for (let w of windows) {
    let activeTab = w.tabs.filter(t => t.active).pop()
    for (let tab of w.tabs){
      await chrome.tabs.highlight({tabs:[activeTab.index, tab.index], windowId:w.id});
      await sleep(10);
      let url = tab.url;
      let priorTab = knownURLs[url];
      let notInGroup = tab.groupId == -1;
      let sameGroupAsPrior = priorTab ? priorTab.groupId == tab.groupId : false;
      if (!priorTab || tab.active) {
        knownURLs[url] = tab;
        if (priorTab && sameGroupAsPrior) {
          idsToRemove.push(priorTab.id)
        }
      } else if (notInGroup || sameGroupAsPrior) {
        idsToRemove.push(tab.id)         
      }
    }
    await chrome.tabs.highlight({tabs:activeTab.index, windowId:w.id});
  }
  await chrome.tabs.remove(idsToRemove.reverse());
  showSuccess();
}



async function switchToPreviousTab() {
  let storage = chrome.storage.session || chrome.storage.local
  storage.get('tabHistory', value => {
    if (value.tabHistory) {
      let info = value.tabHistory[1];
      chrome.tabs.update(info.tabId, { 'active': true });
      chrome.windows.update(info.windowId, { "focused": true });
    }
  })  
}
function sleep(ms) {return new Promise(resolve => setTimeout(resolve, ms)); }

async function discardBackgroundTabs() {
  let windows = await chrome.windows.getAll({populate:true, windowTypes:['normal']});
  for (w of windows) {
    let activeTab = w.tabs.filter(t => t.active).pop()
    for (tab of w.tabs) {
      await chrome.tabs.highlight({tabs:[activeTab.index, tab.index], windowId:w.id});
      if (!tab.active && !tab.discarded) {
        await chrome.tabs.discard(tab.id)
        await sleep(40);
      } else {
        await sleep(10);
      }
    }
    await chrome.tabs.highlight({tabs:activeTab.index, windowId:w.id});
  }
  showSuccess();
}

async function archiveGroup(tab) {
  let group = await chrome.tabGroups.get(tab.groupId)
  archiveGroupToBookmarks(group)
}
async function groupRelatedTabs() {
  let tabs = (await chrome.tabs.query({active: true, currentWindow: true}));
  let group = await chrome.tabs.group({tabIds:tabs.map(t=>t.id)})
}

async function groupTabsByDomain() {
  sortTabs('domain');
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

function sortWindows(w1,w2) {
  let i, j;
  for (i = 0; i < w1.tabs.length; i++) { if (!w1.tabs[i] || !w1.tabs[i].pinned) break; }
  for (j = 0; j < w1.tabs.length; j++) { if (!w2.tabs[j] || !w2.tabs[j].pinned) break; } 
  if (j - i == 0) return w2.tabs.length - w1.tabs.length;
  return j - i;
}

function sortByDomain(a,b) {
  return a.reverseHost.localeCompare(b.reverseHost);
}
function sortByTitle(a,b) {
  return a.title.localeCompare(b.title);
}
function sortByKey(key, a, b) {
  return a[key] - b[key];
}

async function sortTabs(type, preserveGroups = true) {
  let windows = await chrome.windows.getAll({populate:true, windowTypes:['normal']})
  for (w of windows) {
    let tabs = w.tabs
    for (tab of tabs) {
      tab.domain = tab.url
      try {
        let hostname =  new URL(tab.url).hostname;
        tab.hostname = hostname;
        tab.reverseHost = hostname.split('.').reverse().join('.');;
      } catch (e) {
        tab.reverseHost = "zzzz." + tab.url; // lol
      } 
    };

    let groups = {}

    if (type == 'domain') {
      tabs.sort(sortByDomain);
    } else if (type == 'title') {
      tabs.sort(sortByTitle);
    } else if (type == 'type') {
      tabs.sort(sortByType); 
    }

    let orderedIds = [];      
    for (tab of tabs) {
      if (tab.pinned) continue;
      if (preserveGroups && tab.groupId > 0) continue;
      orderedIds.push(tab.id);
      let cluster = tab.hostname;
      if (cluster) {
        if (!groups[cluster]) groups[cluster] = [];
        groups[cluster].push(tab.id) 
      }
    };

    await chrome.tabs.move(orderedIds, {index:-1, windowId:w.id});
    await chrome.tabs.ungroup(orderedIds)

    var otherTabs = [];
    if (type == 'domain') {
      for (var cluster in groups) {
        let tabIds = groups[cluster];
        if (tabIds.length > 1) {
          let components = cluster.split(".");
          if (components[0] == "www") components.shift();
          components.pop();
          let title = components.reverse().join(" • ");
          
          let existingGroup = (await chrome.tabGroups.query({title, windowId:w.id})).shift();
          if (existingGroup) {
            chrome.tabs.group({tabIds, groupId: existingGroup.id})
            console.log ("Using existing group", existingGroup)
          } else {
            let group = await chrome.tabs.group({tabIds:tabIds, createProperties:{windowId:w.id}})
            await chrome.tabGroups.update(group, {title})  
          }
        } else {
          otherTabs.push(tabIds[0])
        }
      }

      let gid = await chrome.tabs.group({tabIds:otherTabs, createProperties:{windowId:w.id}})
      let group = await chrome.tabGroups.update(gid, {title: "Other"})
      await chrome.tabGroups.move(group.id, {index:-1, windowId:w.id})
      await chrome.tabs.ungroup(otherTabs)
    }
  }
} 

const BOOKMARK_FOLDER_TITLE = "Tab Archive​";
async function getBookmarkRoot() {
  //getDefault(v({bookmarkRoot}));

  var bookmarkRoot;
  if (bookmarkRoot) {
    try {
      await chrome.bookmarks.get(bookmarkRoot)
    } catch(err) {
      bookmarkRoot = undefined;
    }
  }

  if (!bookmarkRoot) {
    let folder = await chrome.bookmarks.search({title:BOOKMARK_FOLDER_TITLE})
    folder = folder[0]

    if (!folder) {
      folder = await chrome.bookmarks.create({parentId: '2', 'title': BOOKMARK_FOLDER_TITLE, index:0});
    }

    if (folder.id) {
      setDefault(v({bookmarkRoot}), bookmarkRoot = folder.id)      
    }
  }
  return bookmarkRoot;
}

async function archiveGroupToBookmarks(group) {
  let rootId = await getBookmarkRoot();
  let title = group.info.title || group.info.color;
  let fancyTitle = `${colorEmoji[group.info.color]} ${title}`;

  let folder = (await chrome.bookmarks.search({title:fancyTitle}))[0];
  if (!folder) folder = await chrome.bookmarks.create({parentId: rootId, title: fancyTitle})

  let tree = (await chrome.bookmarks.getSubTree(folder.id))[0];

  for (var node of tree.children) {
    if (!node.children) {
      let result = await chrome.bookmarks.remove(node.id);
    }
  }

  let promises = [];
  group.tabs.forEach(tab => {
    promises.push(chrome.bookmarks.create({parentId: folder.id, title: tab.title, url: tab.url}))
  })
  let results = await Promise.all(promises);
}
