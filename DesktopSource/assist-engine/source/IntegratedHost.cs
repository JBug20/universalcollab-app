using System;using System.IO;using System.Linq;using System.Threading;using System.Threading.Tasks;using System.Diagnostics;using System.Windows.Forms;using System.Web.Script.Serialization;

public static class IntegratedHost {
 public static bool Active,Testing;public static string DataRoot=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Notify");static StreamWriter output;static readonly object gate=new object();
 public static void Emit(object value){lock(gate){if(output==null)return;try{output.WriteLine(new JavaScriptSerializer{MaxJsonLength=8388608}.Serialize(value));output.Flush();}catch{Application.Exit();}}}
 public static void Run(bool testing=false){
  Testing=testing;if(testing){DataRoot=Path.Combine(Path.GetTempPath(),"UniversalCollab-Assist-Test-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(DataRoot);}
  Active=true;output=new StreamWriter(Console.OpenStandardOutput(),new System.Text.UTF8Encoding(false));
  bool created;using(var mutex=new Mutex(true,"Local\\UniversalCollabPrivateAssistEngine",out created)){
   if(!created){Emit(new{type="error",error="Another combined app is already running."});return;}
   if(!testing&&(Process.GetProcessesByName("UniversalStream Assist").Length>0||Process.GetProcessesByName("Notify").Length>0)){Emit(new{type="error",error="Close the separate Stream Assist/Notify app, then choose Start Assist again."});return;}
   using(var window=new MainWindow()){
    window.PrepareIntegrated();var handle=window.Handle;
    Task.Run(()=>{try{using(var input=new StreamReader(Console.OpenStandardInput())){string line;while((line=input.ReadLine())!=null){if(line.Length>4096)continue;var message=new JavaScriptSerializer().DeserializeObject(line);string action=Protocol.Pick(message,"action"),id=Protocol.Pick(message,"id");window.BeginInvoke((Action)(()=>window.IntegratedCommand(id,action)));}}}catch{}finally{try{window.BeginInvoke((Action)(()=>window.Close()));}catch{}}});
    Application.Run(window);
   }
  }
 }
}
public partial class MainWindow {
 System.Windows.Forms.Timer integratedTimer;bool integratedDialog;
 protected override void SetVisibleCore(bool value){base.SetVisibleCore(IntegratedHost.Active?false:value);}
 public void PrepareIntegrated(){
  ShowInTaskbar=false;TopMost=false;
  integratedTimer=new System.Windows.Forms.Timer{Interval=1000};integratedTimer.Tick+=delegate{IntegratedSnapshot();};integratedTimer.Start();
  FormClosed+=delegate{integratedTimer.Dispose();};
  // Shown does not fire for the hidden owner; initialize the services explicitly.
  try{StartObs();}catch(Exception e){obsError=e.Message;}
  if(!IntegratedHost.Testing){var reload=ReloadSevenTv();}else{sound.Checked=false;desktop.Checked=false;}
  IntegratedSnapshot();
 }
 void IntegratedSnapshot(){
  IntegratedHost.Emit(new{type="state",version="1.2.0-preview.1",sound=sound.Checked,popups=desktop.Checked,error=obsError,
   chatUrl=obsServer==null?"":"http://127.0.0.1:"+ObsPort+"/dock#"+obs.token+"."+obs.sendToken,
   accounts=new[]{"Twitch","YouTube","Kick","Streamlabs"}.Select(n=>new{name=n,identity=AccountIdentity(n),status=n=="Twitch"?twitchStatus:n=="YouTube"?youtubeStatus:n=="Kick"?kickStatus:streamlabsStatus}).ToArray(),
   alerts=alerts.Take(200).Select(a=>new{id=a.ChatId,time=a.Time,platform=a.Platform,kind=a.Kind,name=a.Name,detail=a.Detail,demo=a.Demo}).ToArray()});
 }
 public void IntegratedCommand(string id,string action){
  if(action=="shutdown"){Close();return;}
  if(action=="snapshot"){IntegratedSnapshot();IntegratedHost.Emit(new{type="reply",id=id,ok=true});return;}
  if(integratedDialog){IntegratedHost.Emit(new{type="reply",id=id,ok=false,error="Finish the open settings window first."});return;}
  integratedDialog=true;
  try{
   switch(action){
    case "accounts":ShowAccounts();break;
    case "notifications":ShowNotificationPreferences();break;
    case "preferences":ShowExperience();break;
    case "emotes":ShowSevenTv();break;
    case "integrations":ShowIntegrations();break;
    case "pulsoid":ShowPulse();break;
    case "tools":ShowTools();break;
    case "streamDeck":ShowStreamDeck();break;
    case "collaboration":ShowCollab();break;
    case "obs":ShowObs();break;
    case "appearance":ShowChatAppearance();break;
    case "popout":PopOutAlerts();break;
    case "chatPopout":ShowCombinedChat();break;
    case "samples":Samples();break;
    case "health":ShowConnectionHealth();break;
    case "toggleSound":sound.Checked=!sound.Checked;break;
    case "togglePopups":desktop.Checked=!desktop.Checked;break;
    case "connectSaved":ConnectIntegratedSaved();break;
    default:throw new ArgumentException("Unknown Assist action.");
   }
   IntegratedHost.Emit(new{type="reply",id=id,ok=true});IntegratedSnapshot();
  }catch{IntegratedHost.Emit(new{type="reply",id=id,ok=false,error="Could not complete this action. Check the account or connection settings."});}
  finally{integratedDialog=false;}
 }
 async void ConnectIntegratedSaved(){
  string folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Notify");
  if(twitchStop==null&&File.Exists(Path.Combine(folder,"twitch.dat")))ObserveIntegrated(ToggleTwitch());
  if(youtubeStop==null&&File.Exists(Path.Combine(folder,"youtube.dat")))ObserveIntegrated(ToggleYouTube());
  if(kickStop==null&&File.Exists(Path.Combine(folder,"kick.dat")))ObserveIntegrated(ToggleKick());
  if(streamlabsStop==null&&File.Exists(Path.Combine(folder,"streamlabs.dat")))ObserveIntegrated(ToggleStreamlabs());
  await Task.CompletedTask;
 }
 async void ObserveIntegrated(Task task){try{await task;}catch{IntegratedHost.Emit(new{type="notice",error="A saved connection needs attention. Open Accounts to reconnect."});}}
}
